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

/** Opts an interactive element of a drag region back out, so it stays clickable. */
export const WINDOW_NO_DRAG_CLASS = "[-webkit-app-region:no-drag]";

/** Left padding of the full-width tab bar: the traffic lights end at x ≈ 68, plus a 16px gap. */
export const WINDOW_CONTROLS_INSET_CLASS = "pl-[84px]";

/** Whether the traffic lights currently sit over the editor (false in a browser). */
export const useTrafficLightsInset = (): boolean => {
  const api = desktopApi();
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => api?.onFullScreenChange?.(setFullScreen), [api]);
  return reservesWindowControls(api, fullScreen);
};

/**
 * Legacy exports for the file header, which used to sit next to the traffic lights. They now live
 * in the full-width tab bar, so the file header keeps its plain layout: always false.
 * TODO(persistence owner): drop these with the header's inset branches in FileMenu.
 */
export const WINDOW_CONTROLS_GUTTER_CLASS = "pl-12";
export const useWindowControlsInset = (): boolean => false;
