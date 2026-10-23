import { describe, expect, test } from "bun:test";
import {
  buildTargetPrompt,
  intersectsViewport,
  placeAtAnchor,
  placePromptBox,
  summarizeTargets,
  topRightAnchor,
  VIEWPORT_MARGIN,
} from "./selection-prompt-position";

const viewport = { width: 800, height: 600 };
const size = { width: 28, height: 28 };

describe("topRightAnchor", () => {
  test("axis-aligned frame gives its ne corner", () => {
    const rect = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 160 },
      { x: 100, y: 160 },
    ];
    expect(topRightAnchor([rect])).toEqual({ x: 200, y: 100 });
  });
  test("rotated frame picks the top-right-most corner", () => {
    const tilted = [
      { x: 120, y: 100 },
      { x: 200, y: 130 },
      { x: 185, y: 170 },
      { x: 105, y: 140 },
    ];
    expect(topRightAnchor([tilted])).toEqual({ x: 200, y: 130 });
  });
  test("several frames merge into one box", () => {
    const a = [
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 90 },
      { x: 0, y: 90 },
    ];
    const b = [
      { x: 100, y: 20 },
      { x: 160, y: 20 },
      { x: 160, y: 60 },
      { x: 100, y: 60 },
    ];
    expect(topRightAnchor([a, b])).toEqual({ x: 160, y: 20 });
  });
  test("empty gives null", () => expect(topRightAnchor([])).toBeNull());
});

describe("intersectsViewport", () => {
  const at = (x: number, y: number) => [
    [
      { x, y },
      { x: x + 10, y: y + 10 },
    ],
  ];
  test("inside", () => expect(intersectsViewport(at(10, 10), viewport)).toBe(true));
  test("fully left", () => expect(intersectsViewport(at(-50, 10), viewport)).toBe(false));
  test("fully below", () => expect(intersectsViewport(at(10, 700), viewport)).toBe(false));
});

describe("placeAtAnchor", () => {
  test("up and right of the anchor", () => {
    expect(placeAtAnchor({ x: 300, y: 300 }, size, viewport, { up: true })).toEqual({
      x: 306,
      y: 300 - 6 - 28,
    });
  });
  test("clamps to the right edge", () => {
    const p = placeAtAnchor({ x: 790, y: 300 }, size, viewport, { up: true });
    expect(p.x).toBe(800 - 28 - VIEWPORT_MARGIN);
  });
  test("clamps to the top edge", () => {
    expect(placeAtAnchor({ x: 300, y: 10 }, size, viewport, { up: true }).y).toBe(VIEWPORT_MARGIN);
  });
  test("clamps to the bottom edge", () => {
    expect(placeAtAnchor({ x: 300, y: 900 }, size, viewport).y).toBe(600 - 28 - VIEWPORT_MARGIN);
  });
  test("viewport smaller than the element still returns the margin", () => {
    expect(placeAtAnchor({ x: 5, y: 5 }, size, { width: 20, height: 20 })).toEqual({
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
    });
  });
});

describe("placePromptBox", () => {
  test("keeps the box inside the viewport", () => {
    const p = placePromptBox({ x: 700, y: 560 }, { width: 320, height: 168 }, viewport);
    expect(p).toEqual({ x: 800 - 320 - VIEWPORT_MARGIN, y: 600 - 168 - VIEWPORT_MARGIN });
  });
  test("leaves a position that fits alone", () => {
    expect(placePromptBox({ x: 100, y: 100 }, { width: 320, height: 168 }, viewport)).toEqual({
      x: 100,
      y: 100,
    });
  });
});

describe("buildTargetPrompt", () => {
  test("pins names and ids before the user text", () => {
    expect(buildTargetPrompt([{ id: "a1", name: "Card" }], "make it blue")).toBe(
      "Target layers (edit only these unless asked otherwise): Card (a1)\n\nmake it blue",
    );
  });
  test("caps a long list", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, name: `L${i}` }));
    expect(buildTargetPrompt(many, "x")).toContain(", +3 more");
  });
  test("no targets leaves the text alone", () => expect(buildTargetPrompt([], "hi")).toBe("hi"));
});

describe("summarizeTargets", () => {
  test("one", () => expect(summarizeTargets(["Card"])).toBe("Card"));
  test("two", () => expect(summarizeTargets(["Card", "Button"])).toBe("Card, Button"));
  test("many", () =>
    expect(summarizeTargets(["Card", "Button", "a", "b"])).toBe("Card, Button +2"));
});

describe("the visible part of the canvas", () => {
  const view = { x: 360, y: 8, width: 900, height: 800 };
  test("the button stays out from under the left panel and inside the view", () => {
    const pos = placeAtAnchor({ x: 100, y: 200 }, { width: 32, height: 32 }, view);
    expect(pos.x).toBe(360 + VIEWPORT_MARGIN);
    const right = placeAtAnchor({ x: 1600, y: 200 }, { width: 32, height: 32 }, view);
    expect(right.x).toBe(360 + 900 - 32 - VIEWPORT_MARGIN);
  });
  test("a selection hidden behind a panel shows no button", () => {
    expect(
      intersectsViewport(
        [
          [
            { x: 100, y: 100 },
            { x: 300, y: 300 },
          ],
        ],
        view,
      ),
    ).toBe(false);
    expect(
      intersectsViewport(
        [
          [
            { x: 300, y: 100 },
            { x: 400, y: 300 },
          ],
        ],
        view,
      ),
    ).toBe(true);
  });
});

describe("the prompt box in part of the canvas", () => {
  test("opens inside an offset view", () => {
    const view = { x: 360, y: 8, width: 600, height: 400 };
    const pos = placePromptBox({ x: 100, y: 500 }, { width: 320, height: 168 }, view);
    expect(pos).toEqual({
      x: 360 + VIEWPORT_MARGIN,
      y: 8 + 400 - 168 - VIEWPORT_MARGIN,
    });
  });
});
