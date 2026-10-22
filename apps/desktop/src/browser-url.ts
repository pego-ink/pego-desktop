export type BrowserUrlResult = { ok: true; url: string } | { ok: false; error: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_URL_LENGTH = 8192;
// "scheme:" that is not "host:port" (a port is digits followed by / or the end).
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i;

const hostOf = (input: string): string => {
  const end = input.search(/[/?#]/);
  const authority = end === -1 ? input : input.slice(0, end);
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return (
    host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "")
  ).toLowerCase();
};

/**
 * Turns what the user typed into a loadable URL. Allows http, https, file and about:blank; a bare
 * host or host/path gets https (http for localhost, 127.0.0.1 and [::1]).
 */
export const normalizeBrowserUrl = (input: unknown): BrowserUrlResult => {
  if (typeof input !== "string") return { ok: false, error: "Enter a URL" };
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter a URL" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, error: "The URL is too long" };
  if (text.toLowerCase() === "about:blank") return { ok: true, url: "about:blank" };

  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  const candidate = scheme
    ? text
    : `${text.startsWith("//") ? "" : LOCAL_HOSTS.has(hostOf(text)) ? "http://" : "https://"}${text}`;
  try {
    const parsed = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, error: `${parsed.protocol} URLs are not allowed` };
    }
    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, error: `Not a valid URL: ${text}` };
  }
};
