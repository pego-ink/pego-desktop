import { create } from "zustand";
import type { Canvas as SkCanvas } from "canvaskit-wasm";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import type { Camera } from "@/canvas/types";
import type { Tool } from "@/store/use-tool-store";

/** A pointer sample in both spaces. `screen` is CSS px relative to the canvas element. */
export type ToolPointer = {
  screen: { x: number; y: number };
  doc: { x: number; y: number };
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** 0..1 for pens; 0.5 for mice. */
  pressure: number;
  pointerType: string;
};

/** One press-drag-release gesture owned by a tool. */
export type ToolSession = {
  move: (p: ToolPointer) => void;
  /** Pointer released normally. */
  up: (p: ToolPointer) => void;
  /** Pointer cancelled (lost capture, pointercancel): roll back anything uncommitted. */
  cancel: () => void;
};

/**
 * Behaviour of a canvas tool beyond select/hand/frame/rectangle/ellipse/text. Implementations
 * live in interaction/tools/*.ts and register themselves with `registerToolHandler`. Document
 * changes go through `useDocumentStore` (`commit` for the first change of a gesture, then
 * `extendLast`), like every other gesture.
 */
export type ToolHandler = {
  /** Primary-button press while this tool is active. Return a session to receive move/up. */
  begin: (p: ToolPointer) => ToolSession | null;
  /** Pointer moves with no button pressed (e.g. the pen's rubber-band segment). */
  hover?: (p: ToolPointer) => void;
  doubleClick?: (p: ToolPointer) => boolean;
  /** Keys while the tool is active; return true when handled (Enter/Escape for the pen…). */
  onKeyDown?: (e: KeyboardEvent) => boolean;
  /** The user switched away from this tool: finish or discard in-progress work. */
  deactivate?: () => void;
  /** Screen-space overlay drawn after the selection overlay (previews, anchors, guides). */
  renderOverlay?: (res: CanvasKitResources, canvas: SkCanvas, camera: Camera) => void;
  /** True while the tool shows its own editing chrome, so the selection box/handles are hidden. */
  hidesSelection?: () => boolean;
  /** CSS cursor while the tool is active. */
  cursor?: string;
};

const handlers = new Map<Tool, ToolHandler>();

export const registerToolHandler = (tool: Tool, handler: ToolHandler): void => {
  handlers.set(tool, handler);
};

export const getToolHandler = (tool: Tool): ToolHandler | undefined => handlers.get(tool);

type ToolPreview = { version: number; invalidate: () => void };

/** Handlers call `invalidate()` after changing their preview so the canvas redraws. */
export const useToolPreview = create<ToolPreview>((set) => ({
  version: 0,
  invalidate: () => set((state) => ({ version: state.version + 1 })),
}));
