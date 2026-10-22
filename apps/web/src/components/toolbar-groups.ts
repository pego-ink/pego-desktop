import {
  CircleIcon,
  FrameIcon,
  HandIcon,
  ImageIcon,
  MinusIcon,
  MousePointer2Icon,
  MoveUpRightIcon,
  PencilIcon,
  PenToolIcon,
  SquareIcon,
  StarIcon,
  TriangleIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import type { Tool } from "@/store/use-tool-store";

export type ToolEntry = { tool: Tool; label: string; shortcut: string; Icon: LucideIcon };

export type ToolGroup = {
  id: string;
  label: string;
  tools: readonly ToolEntry[];
};

/** Figma-style toolbar groups, in display order. Multi-tool groups get a menu. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: "move",
    label: "Move tools",
    tools: [
      { tool: "select", label: "Move", shortcut: "V", Icon: MousePointer2Icon },
      { tool: "hand", label: "Hand", shortcut: "H", Icon: HandIcon },
    ],
  },
  {
    id: "frame",
    label: "Frame",
    tools: [{ tool: "frame", label: "Frame", shortcut: "F", Icon: FrameIcon }],
  },
  {
    id: "shapes",
    label: "Shape tools",
    tools: [
      { tool: "rectangle", label: "Rectangle", shortcut: "R", Icon: SquareIcon },
      { tool: "line", label: "Line", shortcut: "L", Icon: MinusIcon },
      { tool: "arrow", label: "Arrow", shortcut: "⇧L", Icon: MoveUpRightIcon },
      { tool: "ellipse", label: "Ellipse", shortcut: "O", Icon: CircleIcon },
      { tool: "polygon", label: "Polygon", shortcut: "", Icon: TriangleIcon },
      { tool: "star", label: "Star", shortcut: "", Icon: StarIcon },
      { tool: "image", label: "Place image…", shortcut: "⇧⌘K", Icon: ImageIcon },
    ],
  },
  {
    id: "pen",
    label: "Pen tools",
    tools: [
      { tool: "pen", label: "Pen", shortcut: "P", Icon: PenToolIcon },
      { tool: "pencil", label: "Pencil", shortcut: "⇧P", Icon: PencilIcon },
    ],
  },
  {
    id: "text",
    label: "Text",
    tools: [{ tool: "text", label: "Text", shortcut: "T", Icon: TypeIcon }],
  },
];

export const groupHasTool = (group: ToolGroup, tool: Tool): boolean =>
  group.tools.some((entry) => entry.tool === tool);

/** The entry a group button shows: the active tool when it belongs to the group, else the last used. */
export const shownEntry = (group: ToolGroup, lastUsed: Tool, active: Tool): ToolEntry => {
  const pick = (tool: Tool) => group.tools.find((entry) => entry.tool === tool);
  return pick(active) ?? pick(lastUsed) ?? (group.tools[0] as ToolEntry);
};

/** Tooltip text: `Rectangle (R)`. */
export const tooltipFor = ({ label, shortcut }: ToolEntry): string =>
  shortcut ? `${label} (${shortcut})` : label;
