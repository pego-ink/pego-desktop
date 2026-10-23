/**
 * How the editor chrome sits around the canvas. "docked": panels and the header are columns and a
 * bar flush with the window edges. "floating": like pen.dev, the panels are rounded cards and the
 * header controls are pills, with canvas-colored gaps around them.
 */
export type InterfaceStyle = "docked" | "floating";

export const INTERFACE_STYLES = ["docked", "floating"] as const satisfies readonly InterfaceStyle[];

export const INTERFACE_STYLE_LABELS: Record<InterfaceStyle, string> = {
  docked: "Docked",
  floating: "Floating",
};

export const isInterfaceStyle = (value: unknown): value is InterfaceStyle =>
  typeof value === "string" && (INTERFACE_STYLES as readonly string[]).includes(value);

/** The card look of a floating panel or pill. */
export const FLOATING_CARD =
  "rounded-xl border border-border bg-card shadow-[0_8px_24px_rgb(0_0_0/0.18)]";
