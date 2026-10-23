import { useSettingsStore } from "@/store/use-settings-store";

/**
 * The editor uses the floating interface (Settings › General › Interface). Only that choice
 * switches it, never the window size: the two layouts are different trees, so a switch remounts
 * the canvas and the side panels. Narrow windows keep floating, with the cards capped instead
 * (see EditorShell). The dashboard is always docked.
 */
export const useFloatingInterface = (): boolean =>
  useSettingsStore((s) => s.interfaceStyle === "floating");
