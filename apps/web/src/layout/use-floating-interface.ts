import { useSettingsStore } from "@/store/use-settings-store";
import { useWideEnoughForFloating } from "./interface-style";

/**
 * The editor uses the floating interface: chosen in settings and the window is wide enough
 * (narrow windows fall back to docked; the dashboard is always docked, see EditorShell).
 */
export const useFloatingInterface = (): boolean => {
  const chosen = useSettingsStore((s) => s.interfaceStyle === "floating");
  const wide = useWideEnoughForFloating();
  return chosen && wide;
};
