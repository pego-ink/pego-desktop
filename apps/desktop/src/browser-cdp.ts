/** Mirrors `DesktopBrowserBounds` in apps/web/src/desktop/desktop-api.ts. */
export type BrowserBounds = { x: number; y: number; width: number; height: number };

const ALLOWED_DOMAINS = new Set([
  "DOM",
  "Input",
  "Page",
  "Runtime",
  "Emulation",
  "CSS",
  "Accessibility",
]);
const METHOD = /^([A-Z][A-Za-z]*)\.([a-z][A-Za-z0-9]*)$/;
const MAX_BOUND = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only `Domain.command` names of the allowed CDP domains pass. */
export const isAllowedCdpMethod = (method: unknown): method is string => {
  if (typeof method !== "string") return false;
  const domain = METHOD.exec(method)?.[1];
  return domain !== undefined && ALLOWED_DOMAINS.has(domain);
};

export type CdpRequest = { method: string; params?: Record<string, unknown> };

/** Validates an IPC cdp payload; null when it is malformed or the method is not allowed. */
export const parseCdpRequest = (method: unknown, params: unknown): CdpRequest | null => {
  if (!isAllowedCdpMethod(method)) return null;
  if (params === undefined || params === null) return { method };
  return isRecord(params) ? { method, params } : null;
};

/** Validates bounds from the renderer: finite, non-negative size; returns rounded values. */
export const parseBounds = (value: unknown): BrowserBounds | null => {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  const nums = [x, y, width, height];
  if (!nums.every((n): n is number => typeof n === "number" && Number.isFinite(n))) return null;
  if ((width as number) < 0 || (height as number) < 0) return null;
  if (nums.some((n) => Math.abs(n as number) > MAX_BOUND)) return null;
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number),
  };
};

/** Parses a console message of the form `__pego__:{json}`; undefined for anything else. */
export const parsePageMessage = (message: unknown, prefix: string): unknown => {
  if (typeof message !== "string" || !message.startsWith(prefix)) return undefined;
  try {
    return JSON.parse(message.slice(prefix.length)) as unknown;
  } catch {
    return undefined;
  }
};
