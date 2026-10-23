import { describe, expect, test } from "bun:test";
import { emulationPlan, HIDE_SCROLLBARS } from "@/browser/browser-device";
import { deviceLayout } from "@/browser/device-layout";
import { findPreset } from "@/browser/device-presets";

const pixel = () =>
  deviceLayout(findPreset("pixel-8"), false, { x: 0, y: 0, width: 400, height: 900 });

describe("emulationPlan (CDP fallback)", () => {
  test("responsive clears the override and touch", () => {
    expect(emulationPlan(null, false)).toEqual({
      cdp: [
        { method: "Emulation.clearDeviceMetricsOverride" },
        { method: "Emulation.setTouchEmulationEnabled", params: { enabled: false } },
        HIDE_SCROLLBARS,
      ],
    });
  });

  test("a device sets metrics and touch", () => {
    const plan = emulationPlan(pixel(), false);
    const [metrics, touch] = plan.cdp;
    expect(plan.native).toBeUndefined();
    expect(metrics?.method).toBe("Emulation.setDeviceMetricsOverride");
    expect(metrics?.params).toMatchObject({ width: 412, mobile: true });
    expect(touch?.params).toEqual({ enabled: true });
  });
});

describe("emulationPlan (native)", () => {
  test("responsive turns native emulation off and touch off", () => {
    expect(emulationPlan(null, true)).toEqual({
      native: null,
      cdp: [
        { method: "Emulation.setTouchEmulationEnabled", params: { enabled: false } },
        HIDE_SCROLLBARS,
      ],
    });
  });

  test("a device uses native emulation and only touch over CDP", () => {
    const layout = pixel();
    const plan = emulationPlan(layout, true);
    expect(plan.native).toMatchObject({
      width: 412,
      mobile: true,
      scale: layout?.scale,
      screenWidth: 412,
    });
    expect(plan.native).not.toHaveProperty("deviceScaleFactor");
    expect(plan.cdp).toEqual([
      { method: "Emulation.setTouchEmulationEnabled", params: { enabled: true } },
      HIDE_SCROLLBARS,
    ]);
  });
});
