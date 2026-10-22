import type { EditorSettings } from "@/store/use-settings-store";

/** Arrow-key nudge distance in px: the large step with Shift, the small one otherwise. */
export const nudgeStep = (
  shiftKey: boolean,
  settings: Pick<EditorSettings, "nudgeSmall" | "nudgeLarge">,
): number => (shiftKey ? settings.nudgeLarge : settings.nudgeSmall);
