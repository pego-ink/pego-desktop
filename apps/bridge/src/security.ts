const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * DNS-rebinding protection: the bridge only answers requests addressed to its own loopback
 * name and port. A rebound attacker domain arrives with a foreign Host header.
 */
export const isHostAllowed = (host: string | null, port: number): boolean => {
  if (!host) return false;
  const lower = host.toLowerCase();
  return lower === `127.0.0.1:${port}` || lower === `localhost:${port}`;
};

const isLocalOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
};

/**
 * Origin check. With an explicit allowlist only exact matches pass. Without one (default) any
 * localhost / 127.0.0.1 origin passes, so a dev server that moved off port 5173 still works,
 * while every remote website is rejected. `"null"` origins (sandboxed iframes, file://) never pass.
 */
export const isOriginAllowed = (origin: string | null, allowed: string[] | null): boolean => {
  if (!origin) return false;
  if (allowed === null) return isLocalOrigin(origin);
  return allowed.includes(origin);
};
