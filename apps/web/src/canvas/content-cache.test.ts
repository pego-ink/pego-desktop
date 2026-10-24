import { describe, expect, test } from "bun:test";
import { canReuse, layerToScreen, renderedArea, type RenderedView } from "./content-cache";

// Rendered at pan (100, 50), zoom 1, for a 1000 x 800 view with a 256 px margin.
const view: RenderedView = { panX: 100, panY: 50, zoom: 1, padding: 256, width: 1000, height: 800 };

describe("content cache", () => {
  test("the layer holds the view plus its margin", () => {
    expect(renderedArea(view)).toEqual({ x: -356, y: -306, width: 1512, height: 1312 });
  });

  test("panning within the margin reuses it; past it, or resized, renders again", () => {
    expect(canReuse(view, { panX: 100, panY: 50, zoom: 1 }, 1000, 800)).toBe(true);
    expect(canReuse(view, { panX: 300, panY: -150, zoom: 1 }, 1000, 800)).toBe(true);
    expect(canReuse(view, { panX: 400, panY: 50, zoom: 1 }, 1000, 800)).toBe(false);
    expect(canReuse(view, { panX: 100, panY: 50, zoom: 1 }, 1200, 800)).toBe(false);
  });

  test("zooming in reuses it up to 3x; zooming out past the margin does not", () => {
    expect(canReuse(view, { panX: 100, panY: 50, zoom: 2 }, 1000, 800)).toBe(true);
    expect(canReuse(view, { panX: 100, panY: 50, zoom: 3.5 }, 1000, 800)).toBe(false);
    expect(canReuse(view, { panX: 100, panY: 50, zoom: 0.5 }, 1000, 800)).toBe(false);
  });

  test("layerToScreen puts every document point where the camera shows it", () => {
    const camera = { panX: 40, panY: -20, zoom: 2 };
    const place = layerToScreen(view, camera);
    // Document point (10, 10): in the layer at 10 * 1 + 100 + 256 = 366, 10 + 50 + 256 = 316.
    expect(366 * place.scale + place.x).toBe(10 * 2 + 40);
    expect(316 * place.scale + place.y).toBe(10 * 2 - 20);
  });
});
