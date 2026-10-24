import {
  FIND_IMAGES_EXPRESSION,
  googleImagesUrl,
  isGoogleInterstitial,
  pageImages,
  type PageImage,
  type StockImage,
} from "@pego/agent";

/**
 * Image search through Pego's built-in browser (desktop app): Google Images for the query, read
 * from the page the browser loaded. Results are web pictures, usually copyrighted; the layer
 * keeps where each came from.
 */

export const WEB_IMAGES_PROVIDER = "Google Images";
export const WEB_IMAGE_LICENSE = "Unknown, check the source";

export type ImageSearchRequest = {
  query: string;
  count: number;
  orientation?: "landscape" | "portrait" | "square";
};

/** A found web picture is a stock-image result the panel and the agent already understand. */
export const isWebImage = (image: Pick<StockImage, "provider">): boolean =>
  image.provider === WEB_IMAGES_PROVIDER;

const fitsOrientation = (image: PageImage, orientation: ImageSearchRequest["orientation"]) => {
  if (!orientation) return true;
  const ratio = image.width / Math.max(image.height, 1);
  if (orientation === "landscape") return ratio >= 1.15;
  if (orientation === "portrait") return ratio <= 0.87;
  return ratio > 0.87 && ratio < 1.15;
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the web";
  }
};

/** Page images as search results: the requested orientation first, at most `count`. */
export const toWebResults = (
  images: readonly PageImage[],
  resultsUrl: string,
  request: Pick<ImageSearchRequest, "count" | "orientation">,
): StockImage[] => {
  const matching = images.filter((image) => fitsOrientation(image, request.orientation));
  const rest = images.filter((image) => !fitsOrientation(image, request.orientation));
  return [...matching, ...rest].slice(0, request.count).map((image) => {
    const site = hostOf(image.pageUrl ?? image.url);
    return {
      src: image.url,
      thumb: image.url,
      width: image.width,
      height: image.height,
      title: (image.alt ?? `Image from ${site}`).slice(0, 200),
      creator: site,
      license: WEB_IMAGE_LICENSE,
      pageUrl: image.pageUrl ?? resultsUrl,
      provider: WEB_IMAGES_PROVIDER,
    };
  });
};

/** What the search needs from a browser: open a URL, then read the page (CDP). */
export type WebSearchBrowser = {
  load: (url: string) => Promise<{ url: string }>;
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Search Google Images in the built-in browser. Rejects with a user-readable reason. */
export const searchWebImages = async (
  browser: WebSearchBrowser,
  request: ImageSearchRequest,
): Promise<StockImage[]> => {
  const page = await browser.load(googleImagesUrl(request.query));
  if (isGoogleInterstitial(page.url)) {
    throw new Error(
      "Google asked for a check in the Browser panel. Complete it there and search again.",
    );
  }
  const result = await browser.cdp("Runtime.evaluate", {
    expression: FIND_IMAGES_EXPRESSION,
    returnByValue: true,
  });
  const value =
    typeof result === "object" && result !== null
      ? (result as { result?: { value?: unknown } }).result?.value
      : undefined;
  return toWebResults(pageImages(value, 60), page.url, request);
};
