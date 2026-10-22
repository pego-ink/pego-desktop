import { useThemeStore } from "@/theme/theme";
import { desktopApi, type PegoDesktopApi } from "./desktop-api";

/**
 * Keeps the desktop app's native theme (traffic lights, dialogs, menus) on the editor's theme
 * mode. No-op in a browser. Returns a cleanup function.
 */
export const syncNativeTheme = (
  api: Pick<PegoDesktopApi, "setThemeSource"> | undefined = desktopApi(),
): (() => void) => {
  const setThemeSource = api?.setThemeSource;
  if (!setThemeSource) return () => {};
  setThemeSource(useThemeStore.getState().mode);
  return useThemeStore.subscribe((state, prev) => {
    if (state.mode !== prev.mode) setThemeSource(state.mode);
  });
};
