import type { Rect } from "@/canvas/agent-cursor-motion";

/** Screen boxes of the visible agent cursors, written by the cursors and read by the canvas. */
const rects = new Map<string, Rect>();

export const setCursorRect = (id: string, rect: Rect) => void rects.set(id, rect);
export const clearCursorRect = (id: string) => void rects.delete(id);
export const cursorRects = (): Rect[] => [...rects.values()];
