/** Mirrors `DesktopBrowserEmulation` in apps/web/src/desktop/desktop-api.ts. */
export type BrowserEmulation = {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  scale: number;
  mobile: boolean;
};

const MIN_SIZE = 1;
const MAX_SIZE = 10_000;
const MIN_SCALE = 0.05;
const MAX_SCALE = 1;

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Validates an IPC emulation payload: an emulation, or null (off). Undefined when malformed. */
export const parseEmulation = (payload: unknown): BrowserEmulation | null | undefined => {
  if (payload === null) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const p = payload as Record<string, unknown>;
  if (
    !inRange(p.width, MIN_SIZE, MAX_SIZE) ||
    !inRange(p.height, MIN_SIZE, MAX_SIZE) ||
    !inRange(p.screenWidth, MIN_SIZE, MAX_SIZE) ||
    !inRange(p.screenHeight, MIN_SIZE, MAX_SIZE) ||
    !inRange(p.scale, MIN_SCALE, MAX_SCALE) ||
    typeof p.mobile !== "boolean"
  )
    return undefined;
  return {
    width: p.width,
    height: p.height,
    screenWidth: p.screenWidth,
    screenHeight: p.screenHeight,
    scale: p.scale,
    mobile: p.mobile,
  };
};
