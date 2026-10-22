import { desktopApi, type DesktopBrowserApi } from "@/desktop/desktop-api";
import { useLayoutStore } from "@/store/use-layout-store";
import { useBrowserStore } from "./use-browser-store";
import { pickerStartScript, pickerStopScript, unwrapEvaluation } from "./page-scripts";

const SHOW_TIMEOUT_MS = 5000;

/** The desktop shell's in-app browser, undefined in a plain browser and older shells. */
export const browserApi = (): DesktopBrowserApi | undefined => desktopApi()?.browser;

const requireApi = (): DesktopBrowserApi => {
  const api = browserApi();
  if (!api) throw new Error("The in-app browser is only available in the desktop app");
  return api;
};

/** Runs one of the page scripts and resolves with its value (rejects with the page's message). */
export const evaluateInPage = async (api: DesktopBrowserApi, expression: string) =>
  unwrapEvaluation(
    await api.cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
  );

const handlePageMessage = (message: unknown) => {
  if (typeof message !== "object" || message === null) return;
  const { type } = message as { type?: unknown };
  const store = useBrowserStore.getState();
  if (type === "picked") {
    store.setHasPicked(true);
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
