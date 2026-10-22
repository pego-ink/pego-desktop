import type { BrowserHost, BrowserTarget, DomBox, DomSnapshot } from "@pego/agent";
import type { DesktopBrowserApi } from "@/desktop/desktop-api";
import {
  browserApi,
  ensureBrowserConnected,
  evaluateInPage,
  openBrowserPanel,
  revealBrowserPanel,
} from "./browser-session";
import { boxScript, describeScript, snapshotScript } from "./page-scripts";
import { useBrowserStore } from "./use-browser-store";

const DEFAULT_MAX_SIDE = 8192;

/** Scale that fits the longer side into `maxSide`; never enlarges. */
export const screenshotScale = (box: DomBox, maxSide: number): number =>
  Math.min(1, maxSide / Math.max(box.width, box.height));

/** The tool host's `browser` capability over the desktop shell's browser view. */
export const createBrowserHost = (api: DesktopBrowserApi): BrowserHost => {
  const currentPage: BrowserHost["currentPage"] = () => {
    const { url, title } = useBrowserStore.getState().state;
    return url === "" ? null : { url, title };
  };

  /** Page scripts need a loaded page. */
  const requirePage = () => {
    if (!currentPage()) throw new Error("No page loaded: load a page first");
  };

  return {
    loadPage: async (url) => {
      ensureBrowserConnected();
      // The panel keeps the view hidden until a page is loaded, so navigate first and only
      // then wait for it to be painted (later screenshots need that).
      revealBrowserPanel();
      const page = await api.navigate(url);
      await openBrowserPanel().catch(() => undefined);
      return page;
    },
    currentPage,
    screenshot: async (target, options = {}) => {
      requirePage();
      // A hidden native view does not paint.
      await openBrowserPanel();
      const box = (await evaluateInPage(api, boxScript(target))) as DomBox;
      if (box.width < 1 || box.height < 1) throw new Error("The target has no visible size");
      const scale = screenshotScale(box, options.maxSide ?? DEFAULT_MAX_SIDE);
      const format = options.format ?? "png";
      const shot = (await api.cdp("Page.captureScreenshot", {
        format,
        ...(format === "webp" ? { quality: 85 } : {}),
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale },
        captureBeyondViewport: true,
        fromSurface: true,
      })) as { data: string };
      return {
        dataUrl: `data:image/${format};base64,${shot.data}`,
        width: Math.round(box.width * scale),
        height: Math.round(box.height * scale),
      };
    },
    snapshot: async (target: BrowserTarget) => {
      requirePage();
      return (await evaluateInPage(api, snapshotScript(target))) as DomSnapshot;
    },
    describeElement: async (target: BrowserTarget) => {
      requirePage();
      return (await evaluateInPage(api, describeScript(target))) as string;
    },
    cdp: (method, params) => api.cdp(method, params),
  };
};

let shared: BrowserHost | undefined;

/** One host for every tool host, created on first use; undefined outside the desktop app. */
export const sharedBrowserHost = (): BrowserHost | undefined => {
  const api = browserApi();
  if (!api) return undefined;
  shared ??= createBrowserHost(api);
  return shared;
};
