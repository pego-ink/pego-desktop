import { create } from "zustand";
import { getToolHandler } from "@/interaction/tool-handlers";

export type Tool =
  | "select"
  | "hand"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "text"
  | "pen"
  | "pencil"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "image"
  | "connector";

type ToolState = {
  tool: Tool;
  setTool: (tool: Tool) => void;
};

export const useToolStore = create<ToolState>((set, get) => ({
  tool: "select",
  setTool: (tool) => {
    const previous = get().tool;
    if (previous !== tool) getToolHandler(previous)?.deactivate?.();
    set({ tool });
  },
}));

/** Tools that create a node by dragging out a box. */
export const isDrawTool = (tool: Tool): tool is "frame" | "rectangle" | "ellipse" =>
  tool === "frame" || tool === "rectangle" || tool === "ellipse";

/** Tool shortcut key (lowercase `KeyboardEvent.key`) to tool. */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: "select",
  h: "hand",
  f: "frame",
  a: "frame",
  r: "rectangle",
  o: "ellipse",
  t: "text",
  p: "pen",
  l: "line",
  c: "connector",
};

/** Shift + key (lowercase `KeyboardEvent.key`) to tool, like Figma (Shift+P pencil, Shift+L arrow). */
export const SHIFT_TOOL_KEYS: Readonly<Record<string, Tool>> = {
  p: "pencil",
  l: "arrow",
};
