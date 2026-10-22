import { BrowserWindow, session, WebContentsView, type WebContents } from "electron";
import { BROWSER_CHANNELS, PAGE_MESSAGE_PREFIX } from "@/browser-channels";
import { isAllowedCdpMethod, parsePageMessage, type BrowserBounds } from "@/browser-cdp";
import { normalizeBrowserUrl } from "@/browser-url";

/** Mirrors `DesktopBrowserState` in apps/web/src/desktop/desktop-api.ts. */
export type BrowserState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  visible: boolean;
  error?: string;
};

export type BrowserView = {
  show: (bounds: BrowserBounds) => void;
  hide: () => void;
  navigate: (url: string) => Promise<{ url: string; title: string }>;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  getState: () => BrowserState;
};

const PARTITION = "persist:pego-browser";
const ERR_ABORTED = -3;
const CDP_VERSION = "1.3";

let sessionHardened = false;

/** The page's own session: no permissions, no downloads. */
const hardenBrowserSession = (): void => {
  if (sessionHardened) return;
  sessionHardened = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
};

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);

/** Creates the view controller for one editor window; the native view itself is built lazily. */
export const createBrowserView = (win: BrowserWindow): BrowserView => {
  let view: WebContentsView | null = null;
  let shown = false;
  let nonEmpty = false;
  let error: string | undefined;
  let navToken = 0;

  const editorSend = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(channel, payload);
  };

  const getState = (): BrowserState => {
    const wc = view && !view.webContents.isDestroyed() ? view.webContents : null;
    const history = wc?.navigationHistory;
    return {
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      loading: wc?.isLoading() ?? false,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      visible: shown && nonEmpty,
      ...(error ? { error } : {}),
    };
  };
  const pushState = (): void => editorSend(BROWSER_CHANNELS.state, getState());

  let debuggerAttached = false;
  const ensureDebugger = (wc: WebContents): void => {
    if (debuggerAttached && wc.debugger.isAttached()) return;
    wc.debugger.attach(CDP_VERSION);
    debuggerAttached = true;
  };

  const ensureView = (): WebContentsView => {
    if (view && !view.webContents.isDestroyed()) return view;
    hardenBrowserSession();
    const created = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(PARTITION),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    created.setVisible(false);
    win.contentView.addChildView(created);
    view = created;
    const wc = created.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) void wc.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    wc.debugger.on("detach", () => {
      debuggerAttached = false;
    });
    wc.on("console-message", (details) => {
      const message = parsePageMessage(details.message, PAGE_MESSAGE_PREFIX);
      if (message !== undefined) editorSend(BROWSER_CHANNELS.pageMessage, message);
    });
    wc.on("did-start-loading", () => {
      error = undefined;
      pushState();
    });
    wc.on("did-stop-loading", pushState);
    wc.on("did-navigate", pushState);
    wc.on("did-navigate-in-page", pushState);
    wc.on("page-title-updated", pushState);
    wc.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      error = description || `Load failed (${code})`;
      pushState();
    });
    return created;
  };

  const applyVisibility = (): void => {
    view?.setVisible(shown && nonEmpty);
    pushState();
  };

  const show = (bounds: BrowserBounds): void => {
    const current = ensureView();
    const zoom = win.webContents.getZoomFactor();
    current.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    });
    shown = true;
    nonEmpty = bounds.width > 0 && bounds.height > 0;
    applyVisibility();
  };

  const hide = (): void => {
    shown = false;
    applyVisibility();
  };

  const navigate = async (input: string): Promise<{ url: string; title: string }> => {
    const target = normalizeBrowserUrl(input);
    if (!target.ok) throw new Error(target.error);
    const wc = ensureView().webContents;
    const token = ++navToken;
    try {
      await wc.loadURL(target.url);
    } catch (cause) {
      // Superseded by a newer navigation: not a failure of this one.
      const code = (cause as { errno?: number }).errno;
      if (code === ERR_ABORTED && token !== navToken)
        return { url: wc.getURL(), title: wc.getTitle() };
      const raw = cause instanceof Error ? cause.message : String(cause);
      const reason = /ERR_[A-Z_]+/.exec(raw)?.[0] ?? raw;
      throw new Error(`Could not load ${target.url} (${reason})`, { cause });
    }
    return { url: wc.getURL(), title: wc.getTitle() };
  };

  const withHistory = (action: (wc: WebContents) => void) => (): void => {
    if (view && !view.webContents.isDestroyed()) action(view.webContents);
  };

  const cdp = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (!isAllowedCdpMethod(method)) throw new Error(`CDP method not allowed: ${method}`);
    const wc = ensureView().webContents;
    ensureDebugger(wc);
    return wc.debugger.sendCommand(method, params);
  };

  win.on("closed", () => {
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
  });

  return {
    show,
    hide,
    navigate,
    back: withHistory((wc) => {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    }),
    forward: withHistory((wc) => {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    }),
    reload: withHistory((wc) => wc.reload()),
    stop: withHistory((wc) => wc.stop()),
    cdp,
    getState,
  };
};
