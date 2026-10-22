import { create } from "zustand";
import type { Box } from "@pego/doc";

/** Transient pointer/keyboard state that only affects drawing and the cursor. */
type InteractionState = {
  /** Marquee rectangle in document coordinates. */
  marquee: Box | null;
  spaceDown: boolean;
  panning: boolean;
  /** Cursor while hovering a resize handle or resizing. */
  handleCursor: string | null;
  set: (patch: Partial<Omit<InteractionState, "set">>) => void;
};

export const useInteractionState = create<InteractionState>((set) => ({
  marquee: null,
  spaceDown: false,
  panning: false,
  handleCursor: null,
  set: (patch) => set(patch),
}));

export const deriveCursor = (
  s: Pick<InteractionState, "spaceDown" | "panning" | "handleCursor">,
) => (s.panning ? "grabbing" : s.spaceDown ? "grab" : (s.handleCursor ?? "default"));
