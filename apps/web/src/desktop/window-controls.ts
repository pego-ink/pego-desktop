import { useEffect, useState } from "react";
import { desktopApi, type PegoDesktopApi } from "./desktop-api";

/**
 * True when the macOS traffic lights overlap the editor's top-left corner: the desktop app hides
 * the title bar there, and full screen hides the lights again.
 */
export const reservesWindowControls = (
  api: Pick<PegoDesktopApi, "platform" | "onFullScreenChange"> | undefined,
  fullScreen: boolean,
): boolean =>
  api?.platform === "darwin" && typeof api.onFullScreenChange === "function" && !fullScreen;

/**
 * Lets a top row's empty space drag the window (double click zooms, like a title bar) while its
 * direct children stay clickable.
 */
export const WINDOW_DRAG_CLASS = "[-webkit-app-region:drag] [&>*]:[-webkit-app-region:no-drag]";

/**
 * Left padding for the first toolbar row right of the 44px icon rail: the traffic lights end at
 * x ≈ 68, so 48px starts the row's content at x ≈ 92, a 24px gap.
 */
export const WINDOW_CONTROLS_GUTTER_CLASS = "pl-12";

/** Whether the traffic lights currently sit over the editor (false in a browser). */
export const useWindowControlsInset = (): boolean => {
  const api = desktopApi();
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => api?.onFullScreenChange?.(setFullScreen), [api]);
  return reservesWindowControls(api, fullScreen);
};
