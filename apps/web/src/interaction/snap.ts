import { useSettingsStore } from "@/store/use-settings-store";

/** Round a node x/y/width/height: whole pixels when snapping, otherwise 2 decimals. */
export const roundPx = (value: number, snap: boolean): number =>
  snap ? Math.round(value) : Math.round(value * 100) / 100;

/** Current "snap to whole pixels" setting. */
export const snapEnabled = (): boolean => useSettingsStore.getState().snapToPixel;
