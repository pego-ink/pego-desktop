/** URL helpers shared by the custom-provider runtime and form. Pure; no browser APIs. */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

const parse = (value: string): URL | null => {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
};

/** Host (with port) of a base URL for display; the raw text when it is not a URL. */
export const baseUrlHost = (value: string): string => parse(value)?.host ?? value;

/** True for localhost / loopback URLs, where a provider usually needs no API key. */
export const isLocalBaseUrl = (value: string): boolean => {
  const url = parse(value);
  return url !== null && LOCAL_HOSTS.has(url.hostname.toLowerCase());
};

/**
 * Validate a typed base URL: absolute http(s), https unless local (a key sent over plain http
 * to a remote host would be readable on the wire). Returns the cleaned URL or an error message.
 */
export const checkBaseUrl = (value: string): { url: string } | { error: string } => {
  const text = value.trim();
  if (!text) return { error: "Enter the base URL." };
  const url = parse(text);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return { error: "Enter a full URL starting with https://" };
  }
  if (url.protocol === "http:" && !isLocalBaseUrl(text)) {
    return {
      error: "Use https:// for remote providers. Plain http is only allowed for localhost.",
    };
  }
  if (url.username || url.password) return { error: "Do not put credentials in the URL." };
  return { url: text.replace(/\/+$/, "") };
};
