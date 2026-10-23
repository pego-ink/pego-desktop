import { useSettingsStore } from "@/store/use-settings-store";

/**
 * The editor uses the floating interface (Settings › General › Interface). The window size never
 * switches it: the two layouts are different trees, so a switch remounts the canvas and the side
 * panels. Narrow windows keep floating, with the cards capped instead (see EditorShell). Only this
 * setting and the dashboard switch layouts; the dashboard is always docked, and opening it
 * unmounts the canvas and side panel in the docked layout too, so returning from Home remounts
 * them either way (camera and selection live in stores and survive it).
 */
export const useFloatingInterface = (): boolean =>
  useSettingsStore((s) => s.interfaceStyle === "floating");
