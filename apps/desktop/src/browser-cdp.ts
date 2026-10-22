/** Mirrors `DesktopBrowserBounds` in apps/web/src/desktop/desktop-api.ts. */
export type BrowserBounds = { x: number; y: number; width: number; height: number };

/** Exact CDP methods the editor may call; everything else (Page.navigate, DOM.setFileInputFiles, ...) is refused. */
export const ALLOWED_CDP_METHODS: ReadonlySet<string> = new Set([
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Runtime.getProperties",
  "Runtime.releaseObject",
  "Page.captureScreenshot",
  "Page.getLayoutMetrics",
  "Page.getFrameTree",
  "Page.createIsolatedWorld",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOM.getOuterHTML",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.describeNode",
  "DOM.resolveNode",
  "DOM.requestNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.focus",
  "DOM.getAttributes",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Input.dispatchTouchEvent",
  "Input.dispatchDragEvent",
  "Emulation.setDeviceMetricsOverride",
  "Emulation.clearDeviceMetricsOverride",
  "Emulation.setEmulatedMedia",
  "Emulation.setScrollbarsHidden",
  "Emulation.setDefaultBackgroundColorOverride",
  "Emulation.setTouchEmulationEnabled",
  "CSS.enable",
  "CSS.getComputedStyleForNode",
  "CSS.getMatchedStylesForNode",
  "CSS.getInlineStylesForNode",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "Accessibility.queryAXTree",
]);
const MAX_BOUND = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only the exact methods in `ALLOWED_CDP_METHODS` pass. */
export const isAllowedCdpMethod = (method: unknown): method is string =>
  typeof method === "string" && ALLOWED_CDP_METHODS.has(method);

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

export const MAX_PAGE_MESSAGE_LENGTH = 2048;
const MAX_FIELD_LENGTH = 200;
const MAX_FIELDS = 6;

export type PageMessage = { type: "picked" | "pick-cancelled"; [field: string]: string };

/**
 * Parses a console message of the form `__pego__:{json}`. Only `{type: "picked" | "pick-cancelled"}`
 * with a few short string fields passes; undefined for anything else.
 */
export const parsePageMessage = (message: unknown, prefix: string): PageMessage | undefined => {
  if (typeof message !== "string" || message.length > MAX_PAGE_MESSAGE_LENGTH) return undefined;
  if (!message.startsWith(prefix)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(prefix.length));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.type !== "picked" && parsed.type !== "pick-cancelled") return undefined;
  const entries = Object.entries(parsed);
  if (entries.length > MAX_FIELDS) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH || key.length > 32)
      return undefined;
    out[key] = value;
  }
  return out as PageMessage;
};

/** Sliding one-second window limiter; returns true when the call is within `max` per second. */
export const createRateLimiter = (max: number, now: () => number = Date.now) => {
  let windowStart = 0;
  let count = 0;
  return (): boolean => {
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
};
