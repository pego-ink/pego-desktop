import { describe, expect, test } from "bun:test";
import { hasOpenOverlay, OVERLAY_SELECTOR, sameBounds, viewBounds } from "./browser-panel-view";

const rect = { x: 44.4, y: 90.6, width: 519.5, height: 400.2 };

describe("viewBounds", () => {
  test("rounds the measured rect", () => {
    expect(viewBounds({ rect, hasContent: true, overlayOpen: false })).toEqual({
      x: 44,
      y: 91,
      width: 520,
      height: 400,
    });
  });
  test("hides without content, behind an overlay or before measuring", () => {
    expect(viewBounds({ rect, hasContent: false, overlayOpen: false })).toBeNull();
    expect(viewBounds({ rect, hasContent: true, overlayOpen: true })).toBeNull();
    expect(viewBounds({ rect: null, hasContent: true, overlayOpen: false })).toBeNull();
  });
  test("hides a zero-size region", () => {
    const flat = { ...rect, width: 0 };
    expect(viewBounds({ rect: flat, hasContent: true, overlayOpen: false })).toBeNull();
    expect(
      viewBounds({ rect: { ...rect, height: 0.4 }, hasContent: true, overlayOpen: false }),
    ).toBeNull();
  });
});

describe("sameBounds", () => {
  test("compares by value", () => {
    const a = { x: 1, y: 2, width: 3, height: 4 };
    expect(sameBounds(a, { ...a })).toBe(true);
    expect(sameBounds(a, { ...a, width: 5 })).toBe(false);
    expect(sameBounds(null, null)).toBe(true);
    expect(sameBounds(a, null)).toBe(false);
  });
});

describe("hasOpenOverlay", () => {
  test("asks the DOM with the overlay selector", () => {
    const seen: string[] = [];
    const root = (found: boolean) => ({
      querySelector: (selector: string) => {
        seen.push(selector);
        return found ? ({} as Element) : null;
      },
    });
    expect(hasOpenOverlay(root(true))).toBe(true);
    expect(hasOpenOverlay(root(false))).toBe(false);
    expect(seen[0]).toBe(OVERLAY_SELECTOR);
    expect(OVERLAY_SELECTOR).toContain('[role="dialog"]');
    expect(OVERLAY_SELECTOR).toContain('[role="menu"]');
  });
});
