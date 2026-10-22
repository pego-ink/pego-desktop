// Tool names mirror the document ops in @pego/doc (one op vocabulary).
export const TOOL_NAMES = [
  "insert",
  "update",
  "replace",
  "move",
  "delete",
  "setVariables",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
