import { useCallback, useEffect, useRef } from "react";
import type { DesktopBrowserEmulation } from "@/desktop/desktop-api";
import type { DeviceLayout } from "@/browser/device-layout";
import { browserApi } from "@/browser/browser-session";
import { useBrowserStore } from "@/browser/use-browser-store";

export type CdpCommand = { method: string; params?: Record<string, unknown> };

/** Region-driven updates are coalesced so dragging the panel edge does not spam IPC. */
const DEBOUNCE_MS = 100;

/** What to apply: the native view emulation (when the shell has it) and the CDP calls. */
export type EmulationPlan = {
  /** Undefined = no native emulation (CDP fallback); null = off. */
  native?: DesktopBrowserEmulation | null;
  cdp: CdpCommand[];
};

const touchCommand = (enabled: boolean): CdpCommand => ({
  method: "Emulation.setTouchEmulationEnabled",
  params: { enabled },
});

/**
 * How to put the page in a device (or back to responsive when layout is null). With native
 * emulation the view keeps its bounds and only touch goes over CDP; CDP `scale` would make the
 * page widget as wide as the device and cover the editor, so it stays a fallback for shells
 * without `setEmulation`.
 */
export const emulationPlan = (layout: DeviceLayout | null, native: boolean): EmulationPlan => {
  if (!native) {
    return {
      cdp: layout
        ? [
            { method: "Emulation.setDeviceMetricsOverride", params: { ...layout.metrics } },
            touchCommand(layout.touch),
          ]
        : [{ method: "Emulation.clearDeviceMetricsOverride" }, touchCommand(false)],
    };
  }
  if (!layout) return { native: null, cdp: [touchCommand(false)] };
  const { metrics } = layout;
  return {
    native: {
      width: metrics.width,
      height: metrics.height,
      screenWidth: metrics.screenWidth,
      screenHeight: metrics.screenHeight,
      scale: metrics.scale,
      mobile: metrics.mobile,
    },
    cdp: [touchCommand(layout.touch)],
  };
};

const CLEAR_METRICS: CdpCommand = { method: "Emulation.clearDeviceMetricsOverride" };

const run = async (plan: EmulationPlan, clearLegacy: boolean) => {
  const api = browserApi();
  if (!api || useBrowserStore.getState().state.url === "") return;
  try {
    if (plan.native !== undefined && api.setEmulation) {
      // A leftover CDP metrics override would stack on the native one.
      if (clearLegacy) await api.cdp(CLEAR_METRICS.method);
      api.setEmulation(plan.native);
    }
    for (const { method, params } of plan.cdp) await api.cdp(method, params);
  } catch (error) {
    console.warn("Device emulation failed", error);
  }
};

/**
 * Keeps the page's device emulation in sync. Call the returned `update` with the layout the
 * panel computed (null = responsive). It applies after a short debounce and again after every
 * page load, and does nothing while no page is loaded.
 */
export const useDeviceEmulation = () => {
  const latest = useRef<EmulationPlan | null>(null);
  const applied = useRef("");
  const legacyCleared = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback((force: boolean) => {
    clearTimeout(timer.current);
    const plan = latest.current;
    if (!plan) return;
    const key = JSON.stringify(plan);
    if (!force && key === applied.current) return;
    applied.current = key;
    const clearLegacy = !legacyCleared.current;
    // Only a loaded page can be cleared (run skips otherwise): retry on the next flush.
    if (useBrowserStore.getState().state.url !== "") legacyCleared.current = true;
    void run(plan, clearLegacy);
  }, []);

  const update = useCallback(
    (layout: DeviceLayout | null) => {
      latest.current = emulationPlan(layout, Boolean(browserApi()?.setEmulation));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(false), DEBOUNCE_MS);
    },
    [flush],
  );

  // A new page (url change or load finished) starts without the override: apply it again.
  useEffect(() => {
    const unsubscribe = useBrowserStore.subscribe((state, prev) => {
      const { url, loading } = state.state;
      const loaded = prev.state.loading && !loading;
      if (url !== "" && (url !== prev.state.url || loaded)) flush(true);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, [flush]);

  return update;
};
