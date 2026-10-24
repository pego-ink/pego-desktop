import { useEffect, useState } from "react";
import { CANVAS_BACKGROUND, type ResolvedTheme } from "@/theme/theme";
import { desktopApi, type PegoDesktopApi } from "./desktop-api";

/** The window controls are drawn over the editor's tab row (Linux / Windows "pego" title bar). */
export const drawsWindowControls = (
  api: Pick<PegoDesktopApi, "platform" | "titleBar"> | undefined,
) => api !== undefined && api.platform !== "darwin" && api.titleBar?.mode === "pego";

/** Width the window controls take when the platform does not report it (three 46px buttons). */
const FALLBACK_CONTROLS_WIDTH = 138;

type ControlsOverlay = {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (type: "geometrychange", listener: () => void) => void;
  removeEventListener: (type: "geometrychange", listener: () => void) => void;
};

const controlsOverlay = (): ControlsOverlay | undefined =>
  (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;

/**
 * Space to keep free at the right end of the tab row for the window controls, in px (0 when the
 * window has none there, e.g. in full screen or with the system title bar).
 */
export const useControlsOverlayInset = (): number => {
  const enabled = drawsWindowControls(desktopApi());
  const [inset, setInset] = useState(() => (enabled ? FALLBACK_CONTROLS_WIDTH : 0));
  useEffect(() => {
    const overlay = controlsOverlay();
    if (!enabled || !overlay) return;
    const measure = () => {
      if (!overlay.visible) return setInset(0);
      const rect = overlay.getTitlebarAreaRect();
      setInset(Math.max(0, Math.round(window.innerWidth - (rect.x + rect.width))));
    };
    measure();
    overlay.addEventListener("geometrychange", measure);
    window.addEventListener("resize", measure);
    return () => {
      overlay.removeEventListener("geometrychange", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);
  return inset;
};

/** A CSS color as #rrggbb (any syntax the browser knows, e.g. oklch tokens); null when unknown. */
export const cssColorToHex = (color: string): string | null => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !color || color === "transparent") return null;
  context.fillStyle = "#000000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
};

/**
 * The overlay for the tab row: its background (the canvas color behind the floating row, the
 * panel background otherwise), the text color for the symbols, and the row height.
 */
export const titleBarOverlayFor = (
  row: HTMLElement,
  floating: boolean,
  theme: ResolvedTheme,
): { color: string; symbolColor: string; height: number } | null => {
  const style = getComputedStyle(row);
  const color = floating
    ? CANVAS_BACKGROUND[theme].toLowerCase()
    : cssColorToHex(style.backgroundColor);
  const symbolColor = cssColorToHex(style.color);
  if (!color || !symbolColor) return null;
  return { color, symbolColor, height: Math.round(row.getBoundingClientRect().height) };
};
