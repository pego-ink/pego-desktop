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

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a dotted IPv4 tail folded in). */
const ipv6Groups = (address: string): number[] | null => {
  let text = address.replace(/%.*$/, ""); // zone id (fe80::1%en0)
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail?.[1]) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
};

/** The IPv4 address held in two 16-bit groups. */
const ipv4From = (high: number, low: number): string =>
  `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/** True for IPv6 addresses that are local, private, reserved, or carry such an IPv4 address. */
const isPrivateIpv6 = (groups: number[]): boolean => {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const zeroTo = (n: number) => groups.slice(0, n).every((g) => g === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, also :: and ::1) are judged as IPv4.
  if (zeroTo(5) && (g5 === 0xffff || g5 === 0)) {
    if (g5 === 0 && g6 === 0) return true; // ::, ::1 and the rest of ::/112
    return isPrivateAddress(ipv4From(g6, g7));
  }
  // NAT64 (64:ff9b::/96) carries an IPv4 address in its last 32 bits.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateAddress(ipv4From(g6, g7));
  }
  // 6to4 (2002::/16) carries one in groups 1 and 2.
  if (g0 === 0x2002) return isPrivateAddress(ipv4From(g1, g2));
  return (
    (g0 === 0x64 && g1 === 0xff9b && g2 === 1) || // local-use NAT64 64:ff9b:1::/48
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard 100::/64
    (g0 === 0x2001 && g1 === 0) || // Teredo 2001::/32 (hides an IPv4 address)
    (g0 === 0x2001 && g1 === 0xdb8) || // documentation 2001:db8::/32
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xff00) === 0xff00 // multicast ff00::/8
  );
};

/** True for addresses on the user's machine or private networks (or not routable at all). */
export const isPrivateAddress = (address: string): boolean => {
  const lower = address.toLowerCase();
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
    const groups = ipv6Groups(lower);
    return groups ? isPrivateIpv6(groups) : true;
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
