import type { EditorSettings } from "@/store/use-settings-store";

export type WheelAction = "zoom" | "pan" | "pan-horizontal";

/**
 * What a wheel event does. Ctrl/Cmd (pinch) always zooms. In "zoom" mode a bare wheel zooms and
 * Shift+wheel pans horizontally; in "pan" mode a bare wheel pans (trackpad-like).
 */
export const wheelAction = (
  behavior: EditorSettings["wheelBehavior"],
  e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
): WheelAction => {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (behavior === "zoom") return e.shiftKey ? "pan-horizontal" : "zoom";
  return "pan";
};
