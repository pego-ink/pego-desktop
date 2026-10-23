import { desktopApi, type DesktopBrowserApi } from "@/desktop/desktop-api";
import { useLayoutStore } from "@/store/use-layout-store";
import { useBrowserStore } from "./use-browser-store";
import { pickerStartScript, pickerStopScript, unwrapEvaluation } from "./page-scripts";
import { parsePicked } from "./picked-element";

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

const handlePageMessage = (message: unknown) => {
  if (typeof message !== "object" || message === null) return;
  const { type } = message as { type?: unknown };
  const store = useBrowserStore.getState();
  if (type === "picked") {
    store.setHasPicked(true);
    store.setPicked(parsePicked(message));
    store.setPicking(false);
  } else if (type === "pick-cancelled") {
    store.setPicking(false);
  }
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
      store.setHasPicked(false);
      store.setPicking(false);
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
  await evaluateInPage(api, pickerStartScript);
  useBrowserStore.getState().setPicking(true);
};

/** Disarms the picker; the picked element (if any) stays picked. */
export const stopPicker = async (): Promise<void> => {
  const api = browserApi();
  useBrowserStore.getState().setPicking(false);
  if (!api) return;
  await evaluateInPage(api, pickerStopScript).catch(() => {});
};
