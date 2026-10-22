import { describe, expect, test } from "bun:test";
import { screenToDoc } from "../canvas/types";
import { clampZoom, contentBounds, fitCamera, MAX_ZOOM, MIN_ZOOM, zoomAtPoint } from "./camera";
import { fixtureDoc, fixtureLayout } from "./test-doc";

describe("camera", () => {
  test("zoomAtPoint keeps the doc point under the cursor fixed", () => {
    const cam = { panX: 30, panY: -20, zoom: 1.5 };
    const before = screenToDoc(cam, 200, 150);
    const next = zoomAtPoint(cam, 4, 200, 150);
    const after = screenToDoc(next, 200, 150);
    expect(next.zoom).toBe(4);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  test("zoom clamps to 0.02..64", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(zoomAtPoint({ panX: 0, panY: 0, zoom: 1 }, 999, 0, 0).zoom).toBe(MAX_ZOOM);
  });
  test("fitCamera centers bounds with padding", () => {
    const cam = fitCamera(
      { x: 0, y: 0, width: 800, height: 600 },
      { width: 1000, height: 800 },
      50,
    );
    expect(cam.zoom).toBeCloseTo(900 / 800);
    expect(cam.panX).toBeCloseTo((1000 - 800 * cam.zoom) / 2);
    expect(cam.panY).toBeCloseTo((800 - 600 * cam.zoom) / 2);
  });
  test("contentBounds unions top-level boxes", () =>
    expect(contentBounds(fixtureDoc, fixtureLayout)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 400,
    }));
});
