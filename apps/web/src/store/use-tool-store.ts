import { create } from "zustand";

export type Tool = "select" | "hand" | "frame" | "rectangle" | "ellipse" | "text";

type ToolState = {
  tool: Tool;
  setTool: (tool: Tool) => void;
};

export const useToolStore = create<ToolState>((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool }),
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
};
