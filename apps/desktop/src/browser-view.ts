import { BrowserWindow, session, WebContentsView, type WebContents } from "electron";
import { BROWSER_CHANNELS, PAGE_MESSAGE_PREFIX } from "@/browser-channels";
import {
  createRateLimiter,
  isAllowedCdpMethod,
  parsePageMessage,
  type BrowserBounds,
} from "@/browser-cdp";
import { type BrowserEmulation } from "@/browser-emulation";
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
  navigate: (
    url: string,
    options?: { allowFile?: boolean },
  ) => Promise<{ url: string; title: string }>;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  setEmulation: (emulation: BrowserEmulation | null) => void;
  getState: () => BrowserState;
};

const PARTITION = "persist:pego-browser";
const ERR_ABORTED = -3;
const REDIRECT_SETTLE_MS = 15_000;
const MAX_PAGE_MESSAGES_PER_SECOND = 20;
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
  const allowPageMessage = createRateLimiter(MAX_PAGE_MESSAGES_PER_SECOND);

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

  let emulation: BrowserEmulation | null = null;
  const applyEmulation = (wc: WebContents): void => {
    if (wc.isDestroyed()) return;
    if (!emulation) return wc.disableDeviceEmulation();
    wc.enableDeviceEmulation({
      // "mobile" ignores the page's meta viewport here (pages lay out at 980 px), so phones and
      // tablets use "desktop" too: the layout viewport is then exactly the device width, which
      // is what responsive CSS keys on. Touch is emulated separately over CDP.
      screenPosition: "desktop",
      screenSize: { width: emulation.screenWidth, height: emulation.screenHeight },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: { width: emulation.width, height: emulation.height },
      scale: emulation.scale,
    });
  };

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
    // Page-initiated navigations (links, location, redirects) may only reach http(s);
    // editor-initiated loadURL does not fire these events.
    const blockNonHttp = (event: { preventDefault: () => void }, url: string): void => {
      if (!isHttp(url)) event.preventDefault();
    };
    wc.on("will-navigate", blockNonHttp);
    wc.on("will-redirect", blockNonHttp);
    wc.debugger.on("detach", () => {
      debuggerAttached = false;
    });
    wc.on("console-message", (details) => {
      if (details.frame !== wc.mainFrame) return;
      if (!allowPageMessage()) return;
      const message = parsePageMessage(details.message, PAGE_MESSAGE_PREFIX);
      if (message !== undefined) editorSend(BROWSER_CHANNELS.pageMessage, message);
    });
    wc.on("did-start-loading", () => {
      error = undefined;
      pushState();
    });
    wc.on("did-stop-loading", pushState);
    // Chromium may reset the emulation on a new page: apply the remembered one again.
    wc.on("did-finish-load", () => {
      if (emulation) applyEmulation(wc);
    });
    if (emulation) applyEmulation(wc);
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

  /** Resolves when the view stops loading, or after a timeout. */
  const waitForStop = (wc: WebContents): Promise<void> =>
    new Promise((resolve) => {
      if (wc.isDestroyed() || !wc.isLoading()) return resolve();
      const done = (): void => {
        clearTimeout(timer);
        wc.off("did-stop-loading", done);
        resolve();
      };
      const timer = setTimeout(done, REDIRECT_SETTLE_MS);
      wc.on("did-stop-loading", done);
    });

  const navigate = async (
    input: string,
    options: { allowFile?: boolean } = {},
  ): Promise<{ url: string; title: string }> => {
    const target = normalizeBrowserUrl(input, { allowFile: options.allowFile === true });
    if (!target.ok) throw new Error(target.error);
    const wc = ensureView().webContents;
    const token = ++navToken;
    try {
      await wc.loadURL(target.url);
    } catch (cause) {
      const code = (cause as { errno?: number }).errno;
      if (code === ERR_ABORTED) {
        // Superseded by a newer navigation: not a failure of this one. Otherwise the page most
        // likely redirected itself (location.replace, meta refresh): wait for it to settle.
        if (token === navToken) await waitForStop(wc);
        return { url: wc.getURL(), title: wc.getTitle() };
      }
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
    if (method !== "Page.captureScreenshot") return wc.debugger.sendCommand(method, params);
    // A capture beyond the viewport resizes the page and drops the device emulation afterwards:
    // put it back so the panel keeps showing the chosen device.
    try {
      return await wc.debugger.sendCommand(method, params);
    } finally {
      if (emulation) applyEmulation(wc);
    }
  };

  const setEmulation = (next: BrowserEmulation | null): void => {
    emulation = next;
    if (view && !view.webContents.isDestroyed()) applyEmulation(view.webContents);
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
    setEmulation,
    getState,
  };
};
