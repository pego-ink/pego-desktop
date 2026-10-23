import type { StockImage } from "@pego/agent";

/**
 * Photo search through Openverse (openverse.org, run by WordPress.org): openly licensed images
 * from Flickr, Wikimedia and other collections, no API key needed. Only licenses that allow
 * commercial use are asked for. Images are loaded through Openverse's own image proxy, which
 * sends CORS headers, so the canvas can draw them (the original hosts often do not).
 */
const API = "https://api.openverse.org/v1/images/";
/** Openverse can take 20+ seconds for a query it has not cached yet. */
const TIMEOUT_MS = 45_000;

export type ImageSearchRequest = {
  query: string;
  count: number;
  orientation?: "landscape" | "portrait" | "square";
};

const ASPECT: Record<NonNullable<ImageSearchRequest["orientation"]>, string> = {
  landscape: "wide",
  portrait: "tall",
  square: "square",
};

/** The Openverse search URL for `request` (commercial-use licenses, no mature results). */
export const searchUrl = ({ query, count, orientation }: ImageSearchRequest): string => {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(Math.max(Math.round(count), 1), 20)),
    license_type: "commercial",
    mature: "false",
  });
  if (orientation) params.set("aspect_ratio", ASPECT[orientation]);
  return `${API}?${params}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const httpsUrl = (value: unknown): string | undefined => {
  const url = text(value);
  return url && /^https:\/\//i.test(url) ? url : undefined;
};

/** "CC BY 2.0", "CC0 1.0", "Public Domain Mark 1.0". */
export const licenseLabel = (license: string, version?: string): string => {
  const id = license.toLowerCase();
  const name =
    id === "pdm" ? "Public Domain Mark" : id === "cc0" ? "CC0" : `CC ${id.toUpperCase()}`;
  return version ? `${name} ${version}` : name;
};

/** Openverse's JSON as stock images; anything malformed or without an id is skipped. */
export const parseResults = (body: unknown): StockImage[] => {
  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
  return results.flatMap((item): StockImage[] => {
    if (!isRecord(item)) return [];
    const id = text(item.id);
    const license = text(item.license);
    const pageUrl = httpsUrl(item.foreign_landing_url) ?? httpsUrl(item.detail_url);
    if (!id || !/^[\w-]+$/.test(id) || !license || !pageUrl) return [];
    const proxy = `${API}${id}/thumb/`;
    const width = typeof item.width === "number" && item.width > 0 ? item.width : undefined;
    const height = typeof item.height === "number" && item.height > 0 ? item.height : undefined;
    const creator = text(item.creator);
    return [
      {
        src: `${proxy}?full_size=true`,
        thumb: proxy,
        ...(width && height ? { width, height } : {}),
        title: (text(item.title) ?? "Untitled").slice(0, 200),
        ...(creator ? { creator: creator.slice(0, 120) } : {}),
        license: licenseLabel(license, text(item.license_version)),
        pageUrl,
        provider: "Openverse",
      },
    ];
  });
};

/** Search Openverse; rejects with a readable message when it cannot be reached. */
export const searchOpenverse = async (
  request: ImageSearchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<StockImage[]> => {
  let response: Response;
  try {
    response = await fetchImpl(searchUrl(request), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("Openverse did not answer in time. Try again in a moment.", { cause: error });
    throw new Error("Could not reach Openverse for the image search.", { cause: error });
  }
  if (!response.ok) throw new Error(`Openverse returned HTTP ${response.status}.`);
  return parseResults(await response.json().catch(() => null));
};
