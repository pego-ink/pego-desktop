import type { DesktopBrowserBounds } from "@/desktop/desktop-api";
import { canRotate, deviceSize, isResponsive, type DevicePreset } from "@/browser/device-presets";
import type { ViewRect } from "@/browser/browser-panel-view";

/** Arguments of `Emulation.setDeviceMetricsOverride`. */
export type DeviceMetrics = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  scale: number;
  screenWidth: number;
  screenHeight: number;
};

export type DeviceLayout = {
  bounds: DesktopBrowserBounds;
  metrics: DeviceMetrics;
  touch: boolean;
  /** How much the device is scaled down to fit the region width (1 = actual size). */
  scale: number;
};

/**
 * Where the native view goes and how the page is emulated for a device, or null for responsive
 * (and for a region without area): the view fills the region, no emulation. The device is fit
 * to the region width (never enlarged) and centered; phones and tablets show their full height
 * when it fits, laptops and desktops take the whole region height.
 */
export const deviceLayout = (
  preset: DevicePreset,
  rotated: boolean,
  region: ViewRect,
): DeviceLayout | null => {
  if (isResponsive(preset)) return null;
  const regionWidth = Math.round(region.width);
  const regionHeight = Math.round(region.height);
  if (regionWidth < 1 || regionHeight < 1) return null;
  const { width: deviceWidth, height: deviceHeight } = deviceSize(preset, rotated);
  const scale = Math.min(1, regionWidth / deviceWidth);
  const width = Math.max(1, Math.round(deviceWidth * scale));
  const height = canRotate(preset)
    ? Math.min(regionHeight, Math.max(1, Math.round(deviceHeight * scale)))
    : regionHeight;
  return {
    bounds: {
      x: Math.round(region.x) + Math.round((regionWidth - width) / 2),
      y: Math.round(region.y),
      width,
      height,
    },
    metrics: {
      width: deviceWidth,
      height: Math.max(1, Math.round(height / scale)),
      deviceScaleFactor: 0,
      mobile: preset.mobile,
      scale,
      screenWidth: deviceWidth,
      screenHeight: deviceHeight,
    },
    touch: preset.touch,
    scale,
  };
};
