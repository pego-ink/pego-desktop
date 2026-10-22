import { create } from "zustand";
import type { Box } from "@pego/doc";
import type { Segment } from "@/interaction/drag-target";
import type { Tool } from "@/store/use-tool-store";

/** Transient pointer/keyboard state that only affects drawing and the cursor. */
type InteractionState = {
  /** Marquee rectangle in document coordinates. */
  marquee: Box | null;
  /** Auto-layout insertion line (document coordinates) shown while dragging a node into a slot. */
  dropLine: Segment | null;
  spaceDown: boolean;
  panning: boolean;
  /** Cursor while hovering a resize handle or resizing. */
  handleCursor: string | null;
  set: (patch: Partial<Omit<InteractionState, "set">>) => void;
};

export const useInteractionState = create<InteractionState>((set) => ({
  marquee: null,
  dropLine: null,
  spaceDown: false,
  panning: false,
  handleCursor: null,
  set: (patch) => set(patch),
}));

const TOOL_CURSORS: Partial<Record<Tool, string>> = {
  hand: "grab",
  frame: "crosshair",
  rectangle: "crosshair",
  ellipse: "crosshair",
  text: "text",
};

export const deriveCursor = (
  s: Pick<InteractionState, "spaceDown" | "panning" | "handleCursor">,
  tool: Tool = "select",
) =>
  s.panning
    ? "grabbing"
    : s.spaceDown
      ? "grab"
      : (TOOL_CURSORS[tool] ?? s.handleCursor ?? "default");
