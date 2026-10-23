import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * GET /fetch-image?url=… : the editor asks the bridge for an image it cannot load itself (the
 * site sends no CORS headers). Only for the editor (origin-checked in server.ts), and guarded
 * against being turned on the user's own network (SSRF): https on the default port only, every
 * address the host resolves to must be public, redirects are re-checked (at most 3), and only
 * images (png, jpeg, gif, webp, avif) up to 10 MB come back.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export type FetchImageDeps = {
  lookup?: (hostname: string) => Promise<string[]>;
  fetch?: typeof fetch;
};

export class FetchImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FetchImageError";
  }
}

const defaultLookup = async (hostname: string): Promise<string[]> =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

const ipv4Parts = (address: string): number[] | null => {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
};

/** True for addresses on the user's machine or private networks (or not routable at all). */
export const isPrivateAddress = (address: string): boolean => {
  const lower = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  const v4 = ipv4Parts(lower);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return (
      a === 0 || // "this" network
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local (cloud metadata)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (isIP(lower) === 6) {
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") || // link-local fe80::/10
      lower.startsWith("fc") ||
      lower.startsWith("fd") || // unique local fc00::/7
      lower.startsWith("ff") // multicast
    );
  }
  return true; // not an address we understand: refuse
};

/** The URL to fetch, if it is an https URL on the default port; throws a 400 otherwise. */
export const checkImageUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchImageError("Not a valid URL.", 400);
  }
  if (url.protocol !== "https:") throw new FetchImageError("Only https image URLs.", 400);
  if (url.port !== "" && url.port !== "443")
    throw new FetchImageError("Only the default port.", 400);
  if (url.username || url.password) throw new FetchImageError("No credentials in the URL.", 400);
  return url;
};

/** Refuse hosts that are, or resolve to, private addresses. */
const checkHost = async (url: URL, resolveHost: (host: string) => Promise<string[]>) => {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolveHost(host).catch(() => []);
  if (addresses.length === 0) throw new FetchImageError(`Could not find ${host}.`, 502);
  if (addresses.some(isPrivateAddress)) {
    throw new FetchImageError("That address is on a private network.", 403);
  }
};

/** Read the body, refusing anything over MAX_IMAGE_BYTES. */
const readLimited = async (response: Response): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new FetchImageError("The image is larger than 10 MB.", 413);
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new FetchImageError("The image is larger than 10 MB.", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/** Fetch the image at `raw` for the editor: its bytes and media type. */
export const fetchImage = async (
  raw: string,
  deps: FetchImageDeps = {},
): Promise<{ bytes: Uint8Array; type: string }> => {
  const resolveHost = deps.lookup ?? defaultLookup;
  let url = checkImageUrl(raw);
  for (let hop = 0; ; hop++) {
    await checkHost(url, resolveHost);
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(url, {
        redirect: "manual",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new FetchImageError(`Could not reach ${url.hostname}.`, 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) throw new FetchImageError("Too many redirects.", 502);
      url = checkImageUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok)
      throw new FetchImageError(`${url.hostname} answered HTTP ${response.status}.`, 502);
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw new FetchImageError("That URL is not an image.", 415);
    return { bytes: await readLimited(response), type };
  }
};
