import { desktopApi, type DesktopBrowserApi } from "@/desktop/desktop-api";
import { useLayoutStore } from "@/store/use-layout-store";
import { useBrowserStore } from "./use-browser-store";
import {
  componentNamesScript,
  pickerStartScript,
  pickerStopScript,
  selectBySelectorScript,
  unwrapEvaluation,
} from "./page-scripts";
import { importToCanvas, screenshotToCanvas } from "./browser-actions";
import { parsePicked, withComponents, type PickedElement } from "./picked-element";
import { createPickerNonce, hasPickerNonce } from "./picker-nonce";

const SHOW_TIMEOUT_MS = 5000;

/** The desktop shell's in-app browser, undefined in a plain browser and older shells. */
export const browserApi = (): DesktopBrowserApi | undefined => desktopApi()?.browser;

const requireApi = (): DesktopBrowserApi => {
  const api = browserApi();
  if (!api) throw new Error("The in-app browser is only available in the desktop app");
  return api;
};

const WORLD_NAME = "pego";
const CONTEXT_GONE = /cannot find context|context was destroyed|execution context/i;

type World = { url: string; contextId: Promise<number> };
let world: World | undefined;

const createWorld = async (api: DesktopBrowserApi): Promise<number> => {
  const tree = (await api.cdp("Page.getFrameTree")) as { frameTree?: { frame?: { id?: string } } };
  const frameId = tree.frameTree?.frame?.id;
  if (!frameId) throw new Error("The page has no main frame");
  const created = (await api.cdp("Page.createIsolatedWorld", {
    frameId,
    worldName: WORLD_NAME,
    grantUniveralAccess: false,
  })) as { executionContextId?: number };
  if (typeof created.executionContextId !== "number") {
    throw new Error("The page's script context could not be created");
  }
  return created.executionContextId;
};

/** The isolated world's context id for the current page, created once per page URL. */
const worldContext = (api: DesktopBrowserApi, fresh: boolean): Promise<number> => {
  const url = useBrowserStore.getState().state.url;
  if (fresh || !world || world.url !== url) {
    const next: World = { url, contextId: createWorld(api) };
    world = next;
    next.contextId.catch(() => {
      if (world === next) world = undefined;
    });
  }
  return world.contextId;
};

const evaluateOnce = async (api: DesktopBrowserApi, expression: string, fresh: boolean) =>
  unwrapEvaluation(
    await api.cdp("Runtime.evaluate", {
      expression,
      contextId: await worldContext(api, fresh),
      returnByValue: true,
      awaitPromise: true,
    }),
  );

/**
 * Runs one of the page scripts in an isolated world (the page cannot tamper with JSON,
 * getComputedStyle, ...) and resolves with its value (rejects with the page's message). A lost
 * context (navigation, reload) is recreated once.
 */
export const evaluateInPage = async (api: DesktopBrowserApi, expression: string) => {
  try {
    return await evaluateOnce(api, expression, false);
  } catch (error) {
    if (!CONTEXT_GONE.test(error instanceof Error ? error.message : String(error))) throw error;
    return evaluateOnce(api, expression, true);
  }
};

/**
 * Names of the React/Vue/Svelte components along the picked element's path, read in the page's
 * own world. Best effort: production builds have none, and a failure leaves the pick as it is.
 */
const addComponentNames = async (picked: PickedElement) => {
  const api = browserApi();
  if (!api) return;
  try {
    const names = unwrapEvaluation(
      await api.cdp("Runtime.evaluate", { expression: componentNamesScript, returnByValue: true }),
    );
    const store = useBrowserStore.getState();
    // Only if nothing else was picked meanwhile.
    if (Array.isArray(names) && store.picked?.selector === picked.selector) {
      store.setPicked(withComponents(picked, names));
    }
  } catch {
    // The names are a nicety; the pick stands without them.
  }
};

/**
 * The armed picker's secret, made here and handed only to the picker script (isolated world), so
 * page scripts cannot forge picker messages. One per armed picker; cleared when it stops.
 */
let pickerNonce: string | undefined;
/** A pick action (import / screenshot) is running: one at a time. */
let actionInFlight = false;

/** Record a pick reported by the page (picker click or keys, or a crumb). */
const acceptPick = (info: unknown) => {
  const parsed = parsePicked(info);
  if (!parsed) return;
  const store = useBrowserStore.getState();
  const picked: PickedElement = { ...parsed, url: store.state.url };
  store.setPicked(picked);
  store.setHasPicked(true);
  void addComponentNames(picked);
};

const runPickAction = (action: unknown) => {
  if (actionInFlight) return;
  actionInFlight = true;
  const target = { kind: "selection" } as const;
  const run = action === "screenshot" ? screenshotToCanvas(target) : importToCanvas(target);
  void Promise.resolve(run)
    .catch(() => {})
    .finally(() => {
      actionInFlight = false;
    });
};

const handlePageMessage = (message: unknown) => {
  if (typeof message !== "object" || message === null) return;
  // Anything the page itself could have written lacks the nonce of the armed picker.
  if (!hasPickerNonce(message, pickerNonce)) return;
  const { type, action } = message as { type?: unknown; action?: unknown };
  const store = useBrowserStore.getState();
  // The picker stays armed after a pick, like a DOM inspector.
  if (type === "picked") acceptPick(message);
  else if (type === "pick-cancelled") {
    pickerNonce = undefined;
    store.setPicking(false);
  } else if (
    type === "pick-action" &&
    store.picking &&
    store.hasPicked &&
    (action === "import" || action === "screenshot")
  ) {
    runPickAction(action);
  }
};

/** Pick the element of a breadcrumb (an ancestor or the element itself). */
export const pickCrumb = async (selector: string): Promise<void> => {
  const api = requireApi();
  acceptPick(await evaluateInPage(api, selectBySelectorScript(selector)));
};

let connected = false;

/** Mirrors the native view's state and the page's messages into the store; idempotent. */
export const ensureBrowserConnected = (): void => {
  if (connected) return;
  const api = browserApi();
  if (!api) return;
  connected = true;
  api.onState((next) => {
    const store = useBrowserStore.getState();
    // A new page loses the picked element and the armed picker.
    if (next.url !== store.state.url) {
      pickerNonce = undefined;
      store.setHasPicked(false);
      store.setPicking(false);
      store.setPicked(null);
    }
    store.setState(next);
  });
  api.onPageMessage(handlePageMessage);
};

/** Shows the Browser side panel without waiting for the native view. */
export const revealBrowserPanel = () => useLayoutStore.getState().openRailTab("browser");

/** Opens the Browser side panel and waits until the native view is shown. */
export const openBrowserPanel = (): Promise<void> => {
  ensureBrowserConnected();
  if (useBrowserStore.getState().state.visible) return Promise.resolve();
  useLayoutStore.getState().openRailTab("browser");
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const unsubscribe = useBrowserStore.subscribe((store) => {
      if (store.state.visible) finish();
    });
    const timer = setTimeout(
      () => finish(new Error("The browser panel could not be shown")),
      SHOW_TIMEOUT_MS,
    );
  });
};

/** Arms the element picker in the loaded page. */
export const startPicker = async (): Promise<void> => {
  const api = requireApi();
  ensureBrowserConnected();
  const nonce = createPickerNonce();
  pickerNonce = nonce;
  try {
    await evaluateInPage(api, pickerStartScript(nonce));
  } catch (error) {
    if (pickerNonce === nonce) pickerNonce = undefined;
    throw error;
  }
  useBrowserStore.getState().setPicking(true);
};

/** Disarms the picker; the picked element (if any) stays picked. */
export const stopPicker = async (): Promise<void> => {
  const api = browserApi();
  pickerNonce = undefined;
  useBrowserStore.getState().setPicking(false);
  if (!api) return;
  await evaluateInPage(api, pickerStopScript).catch(() => {});
};
