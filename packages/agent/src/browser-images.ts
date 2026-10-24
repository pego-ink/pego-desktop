import { z } from "zod";

/**
 * Images on the page loaded in the in-app browser, for the `browser` tool's find-images and
 * search-images actions. The page script only reads the document; what it returns is untrusted
 * page data and is checked here before the agent sees it.
 */

/** How many images an answer lists. */
export const MAX_PAGE_IMAGES = 24;
/** Smaller pictures are icons and logos, not photos. */
const MIN_SIDE = 120;

/** Google Images results for `query` (the `udm=2` image tab). */
export const googleImagesUrl = (query: string): string =>
  `https://www.google.com/search?udm=2&q=${encodeURIComponent(query.trim())}`;

/** Google answered with its "unusual traffic" check or the consent page instead of results. */
export const isGoogleInterstitial = (url: string): boolean =>
  /^https:\/\/(?:www\.)?google\.[a-z.]+\/sorry\//i.test(url) ||
  /^https:\/\/consent\.google\./i.test(url);

/**
 * Runs in the page (Runtime.evaluate, returnByValue). `originals`: full-size image URLs embedded
 * in the page's data as ["url",height,width] (how Google Images lists its results); `images`: the
 * page's own <img> elements with their link.
 */
export const FIND_IMAGES_EXPRESSION = `(() => {
  const html = document.documentElement.innerHTML;
  const originals = [];
  for (const m of html.matchAll(/\\["(https?:\\/\\/[^"\\s]{8,2000}?)",(\\d{2,5}),(\\d{2,5})\\]/g)) {
    originals.push({ url: m[1], height: Number(m[2]), width: Number(m[3]) });
    if (originals.length >= 400) break;
  }
  const images = [];
  for (const img of document.images) {
    const link = img.closest("a");
    images.push({
      url: img.currentSrc || img.src,
      width: img.naturalWidth,
      height: img.naturalHeight,
      alt: (img.alt || "").slice(0, 200),
      link: link ? link.href : "",
    });
    if (images.length >= 400) break;
  }
  return { originals, images };
})()`;

const rawSchema = z.object({
  originals: z
    .array(z.object({ url: z.string(), width: z.number(), height: z.number() }))
    .default([]),
  images: z
    .array(
      z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
        alt: z.string().optional(),
        link: z.string().optional(),
      }),
    )
    .default([]),
});

export type PageImage = {
  /** Full image URL (https): what place_image takes as src. */
  url: string;
  width: number;
  height: number;
  alt?: string;
  /** The page the image links to, for credit (place_image sourceUrl). */
  pageUrl?: string;
};

/** Hosts whose images are the search engine's own chrome or thumbnails, not results. */
const OWN_HOSTS = /(^|\.)(gstatic\.com|google\.[a-z.]+|googleusercontent\.com|googleapis\.com)$/i;

/** Undo the JSON / JS string escapes Google's page data uses in URLs (=, &, \/). */
const unescapeUrl = (url: string): string =>
  url
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, "/");

const httpsUrl = (raw: string | undefined): URL | null => {
  if (!raw) return null;
  try {
    const url = new URL(unescapeUrl(raw));
    return url.protocol === "https:" && url.href.length <= 2000 ? url : null;
  } catch {
    return null;
  }
};

/**
 * The page's photos, best first: full-size originals from the page data, then its own large
 * <img> elements. https only, no search-engine chrome, no duplicates, at most `limit`.
 */
export const pageImages = (raw: unknown, limit = MAX_PAGE_IMAGES): PageImage[] => {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const found: PageImage[] = [];
  const add = (image: PageImage) => {
    if (found.length >= limit || seen.has(image.url)) return;
    seen.add(image.url);
    found.push(image);
  };
  for (const original of parsed.data.originals) {
    const url = httpsUrl(original.url);
    if (!url || OWN_HOSTS.test(url.hostname)) continue;
    if (Math.max(original.width, original.height) < MIN_SIDE) continue;
    add({ url: url.href, width: original.width, height: original.height });
  }
  for (const image of parsed.data.images) {
    const url = httpsUrl(image.url);
    if (!url || OWN_HOSTS.test(url.hostname)) continue;
    if (Math.max(image.width, image.height) < MIN_SIDE) continue;
    const page = httpsUrl(image.link);
    add({
      url: url.href,
      width: image.width,
      height: image.height,
      ...(image.alt?.trim() ? { alt: image.alt.trim() } : {}),
      ...(page && !OWN_HOSTS.test(page.hostname) ? { pageUrl: page.href } : {}),
    });
  }
  return found;
};
