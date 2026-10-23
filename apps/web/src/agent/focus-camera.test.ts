/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { focusCamera } from "./focus-camera";

describe("focusCamera", () => {
  const boxes = [{ x: 100, y: 100, width: 200, height: 100 }];

  test("centers the boxes in the viewport, never zooming in past 1", () => {
    const camera = focusCamera(boxes, { width: 800, height: 600 });
    expect(camera).toEqual({ zoom: 1, panX: 400 - 200, panY: 300 - 150 });
  });

  test("an offset view (floating panels) centers them in that part of the canvas", () => {
    const whole = focusCamera(boxes, { width: 800, height: 600 })!;
    const part = focusCamera(boxes, { x: 320, y: 8, width: 800, height: 600 });
    expect(part).toEqual({ zoom: whole.zoom, panX: whole.panX + 320, panY: whole.panY + 8 });
  });

  test("nothing to show, or no viewport: null", () => {
    expect(focusCamera([], { width: 800, height: 600 })).toBeNull();
    expect(focusCamera(boxes, { width: 0, height: 600 })).toBeNull();
  });
});
