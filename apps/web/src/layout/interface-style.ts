import { useSyncExternalStore } from "react";
/**
 * How the editor chrome sits around the canvas. "docked": panels and the header are columns and a
 * bar flush with the window edges. "floating": like pen.dev, the panels are rounded cards and the
 * header controls are pills, with canvas-colored gaps around them.
 */
export type InterfaceStyle = "docked" | "floating";

export const INTERFACE_STYLES = ["docked", "floating"] as const satisfies readonly InterfaceStyle[];

export const INTERFACE_STYLE_LABELS: Record<InterfaceStyle, string> = {
  docked: "Docked",
  floating: "Floating",
};

export const isInterfaceStyle = (value: unknown): value is InterfaceStyle =>
  typeof value === "string" && (INTERFACE_STYLES as readonly string[]).includes(value);

/** The card look of a floating panel or pill. */
export const FLOATING_CARD =
  "rounded-xl border border-border bg-card shadow-[0_8px_24px_rgb(0_0_0/0.18)]";

/** Below this window width the floating cards leave too little canvas: the docked layout is used. */
export const FLOATING_MIN_WIDTH = 1000;

const wideQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(`(min-width: ${FLOATING_MIN_WIDTH}px)`)
    : null;

const subscribeWide = (onChange: () => void) => {
  const query = wideQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

/** True while the window is wide enough for the floating interface (always, without a window). */
export const useWideEnoughForFloating = (): boolean =>
  useSyncExternalStore(
    subscribeWide,
    () => wideQuery()?.matches ?? true,
    () => true,
  );
