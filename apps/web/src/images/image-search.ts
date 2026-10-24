import type { StockImage } from "@pego/agent";
import { browserApi } from "@/browser/browser-session";
import { sharedBrowserHost } from "@/browser/browser-host";
import { useSettingsStore } from "@/store/use-settings-store";
import { searchOpenverse } from "./openverse";
import {
  searchWebImages,
  type ImageSearchRequest,
  type WebSearchBrowser,
} from "./web-image-search";

/** Searches go through the built-in browser: the setting asks for it and the app has one. */
export const searchesWithBrowser = (): boolean =>
  useSettingsStore.getState().imageSearch === "browser" && browserApi() !== undefined;

/**
 * The built-in browser for a search. `reveal` shows the Browser panel while it works (the agent:
 * the user sees Pego search); otherwise the page loads behind the panel the user is in.
 */
const searchBrowser = (reveal: boolean): WebSearchBrowser | null => {
  if (reveal) {
    const host = sharedBrowserHost();
    return host ? { load: (url) => host.loadPage(url), cdp: (m, p) => host.cdp(m, p) } : null;
  }
  const api = browserApi();
  return api ? { load: (url) => api.navigate(url), cdp: (m, p) => api.cdp(m, p) } : null;
};

/**
 * Photos for a query from the chosen source. Google (built-in browser) falls back to Openverse
 * when it is blocked or finds nothing; `note` says so.
 */
export const searchPhotos = async (
  request: ImageSearchRequest,
  options: {
    reveal: boolean;
    /** Tests: the browser to search with (null = none) and the Openverse search. */
    browser?: WebSearchBrowser | null;
    openverse?: (request: ImageSearchRequest) => Promise<StockImage[]>;
  },
): Promise<{ images: StockImage[]; note?: string }> => {
  const openverse = options.openverse ?? ((r: ImageSearchRequest) => searchOpenverse(r));
  const browser =
    options.browser !== undefined
      ? options.browser
      : searchesWithBrowser()
        ? searchBrowser(options.reveal)
        : null;
  if (!browser) return { images: await openverse(request) };
  let reason: string;
  try {
    const images = await searchWebImages(browser, request);
    if (images.length > 0) return { images };
    reason = "Google showed no photos";
  } catch (error) {
    reason = error instanceof Error ? error.message.replace(/\.$/, "") : "Google did not answer";
  }
  return {
    images: await openverse(request),
    note: `${reason}. Showing free photos from Openverse instead.`,
  };
};
