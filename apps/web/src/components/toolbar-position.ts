/** Where the floating tool picker sits on the canvas (Settings › General, or right-click it). */
export type ToolbarPosition = "bottom" | "left" | "right" | "top";

export const TOOLBAR_POSITIONS = [
  "bottom",
  "left",
  "right",
  "top",
] as const satisfies readonly ToolbarPosition[];

export const TOOLBAR_POSITION_LABELS: Record<ToolbarPosition, string> = {
  bottom: "Bottom",
  left: "Left",
  right: "Right",
  top: "Top",
};

export const isToolbarPosition = (value: unknown): value is ToolbarPosition =>
  typeof value === "string" && (TOOLBAR_POSITIONS as readonly string[]).includes(value);

/** How the toolbar lays out at `position`: a column on the sides, its menus open toward the canvas. */
export const toolbarLayout = (
  position: ToolbarPosition,
): { vertical: boolean; menuSide: "top" | "bottom" | "left" | "right" } => {
  switch (position) {
    case "bottom":
      return { vertical: false, menuSide: "top" };
    case "top":
      return { vertical: false, menuSide: "bottom" };
    case "left":
      return { vertical: true, menuSide: "right" };
    case "right":
      return { vertical: true, menuSide: "left" };
  }
};
