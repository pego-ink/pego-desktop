import { describe, expect, test } from "bun:test";
import { deviceLayout } from "@/browser/device-layout";
import { findPreset, parseDeviceChoice, RESPONSIVE } from "@/browser/device-presets";

const region = { x: 10, y: 100, width: 400, height: 900 };

describe("deviceLayout", () => {
  test("responsive has no layout", () => {
    expect(deviceLayout(RESPONSIVE, false, region)).toBeNull();
  });

  test("phone wider than the region is scaled to fit and shows its full height", () => {
    const layout = deviceLayout(findPreset("iphone-15"), false, { ...region, width: 300 });
    expect(layout?.scale).toBeCloseTo(300 / 393);
    expect(layout?.bounds).toEqual({ x: 10, y: 100, width: 300, height: 650 });
    expect(layout?.metrics).toMatchObject({
      width: 393,
      height: 852,
      deviceScaleFactor: 0,
      mobile: true,
      screenWidth: 393,
      screenHeight: 852,
    });
    expect(layout?.touch).toBe(true);
  });

  test("phone is never enlarged and is centered", () => {
    const layout = deviceLayout(findPreset("iphone-15"), false, { ...region, width: 600 });
    expect(layout?.scale).toBe(1);
    expect(layout?.bounds).toEqual({ x: 10 + 104, y: 100, width: 393, height: 852 });
  });

  test("phone height is clipped to a short region", () => {
    const layout = deviceLayout(findPreset("iphone-15"), false, { ...region, height: 500 });
    expect(layout?.bounds.height).toBe(500);
    expect(layout?.metrics.height).toBe(500);
  });

  test("desktop scales down and takes the full region height", () => {
    const layout = deviceLayout(findPreset("macbook-air-13"), false, region);
    const scale = 400 / 1470;
    expect(layout?.bounds).toEqual({ x: 10, y: 100, width: 400, height: 900 });
    expect(layout?.metrics.width).toBe(1470);
    expect(layout?.metrics.height).toBe(Math.round(900 / scale));
    expect(layout?.metrics.scale).toBeCloseTo(scale);
    expect(layout?.metrics.mobile).toBe(false);
    expect(layout?.touch).toBe(false);
  });

  test("rotation swaps width and height on phones and tablets", () => {
    const layout = deviceLayout(findPreset("ipad-air"), true, { ...region, width: 1180 });
    expect(layout?.metrics).toMatchObject({ width: 1180, screenWidth: 1180, screenHeight: 820 });
    expect(layout?.bounds.width).toBe(1180);
    expect(layout?.bounds.height).toBe(820);
  });

  test("rotation is ignored for laptops", () => {
    const layout = deviceLayout(findPreset("macbook-pro-14"), true, { ...region, width: 1512 });
    expect(layout?.metrics.width).toBe(1512);
  });

  test("tiny regions", () => {
    expect(deviceLayout(findPreset("iphone-15"), false, { ...region, width: 0 })).toBeNull();
    const layout = deviceLayout(findPreset("desktop-1920"), false, {
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
    expect(layout?.bounds.width).toBe(3);
    expect(layout?.bounds.height).toBe(2);
    expect(layout?.metrics.height).toBeGreaterThanOrEqual(1);
  });
});

describe("parseDeviceChoice", () => {
  test("falls back to responsive", () => {
    expect(parseDeviceChoice(null).id).toBe("responsive");
    expect(parseDeviceChoice("{oops").id).toBe("responsive");
    expect(parseDeviceChoice('{"id":"nope"}').id).toBe("responsive");
  });

  test("keeps a valid choice and drops rotation where it does not apply", () => {
    expect(parseDeviceChoice('{"id":"pixel-8","rotated":true}')).toEqual({
      id: "pixel-8",
      rotated: true,
    });
    expect(parseDeviceChoice('{"id":"desktop-1440","rotated":true}').rotated).toBe(false);
  });
});
