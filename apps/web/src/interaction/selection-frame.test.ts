import { describe, expect, test } from "bun:test";
import type { Layout, PegoDocument } from "@pego/doc";
import {
  frameCorners,
  frameHandleCursor,
  getSelectionFrame,
  hitFrameHandle,
  labelAnchor,
  resizeFrame,
  toScreenMatrix,
  topmostCorner,
} from "./selection-frame";
import { applyAffine } from "@/canvas/node-transform";

// Group rotated 90 (counter-clockwise) at (100,100); child rect rotated 90 at its local (10,0).
const doc = {
  variables: {},
  children: [
    {
      id: "g",
      type: "group",
      rotation: 90,
      children: [{ id: "r", type: "rectangle", rotation: 90 }],
    },
    { id: "plain", type: "rectangle" },
  ],
} as unknown as PegoDocument;
const layout: Layout = new Map([
  ["g", { x: 100, y: 100, width: 50, height: 50 }],
  ["r", { x: 110, y: 100, width: 20, height: 10 }],
  ["plain", { x: 5, y: 5, width: 20, height: 10 }],
]);

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
};

describe("frame corners and handles", () => {
  test("unrotated node maps to its box", () => {
    const f = getSelectionFrame(doc, layout, "plain")!;
    const [nw, , se] = frameCorners(f.matrix, 20, 10);
    near(nw!, 5, 5);
    near(se!, 25, 15);
  });

  test("node under a rotated ancestor, itself rotated", () => {
    // Group 90 ccw: child (10,0) -> (100, 90). Child 90 ccw on top: 180 total, so local +x is -x.
    const f = getSelectionFrame(doc, layout, "r")!;
    const [nw, ne, se] = frameCorners(f.matrix, 20, 10);
    near(nw!, 100, 90);
    near(ne!, 80, 90);
    near(se!, 80, 80);
  });

  test("frames are cached per doc and layout", () =>
    expect(getSelectionFrame(doc, layout, "r")).toBe(getSelectionFrame(doc, layout, "r")));

  test("handle is hit at its rotated position, not the unrotated one", () => {
    const f = getSelectionFrame(doc, layout, "r")!;
    const screen = toScreenMatrix({ panX: 0, panY: 0, zoom: 1 }, f.matrix);
    expect(hitFrameHandle(screen, 20, 10, 100, 90, 3)).toBe("nw");
    expect(hitFrameHandle(screen, 20, 10, 80, 80, 3)).toBe("se");
    expect(hitFrameHandle(screen, 20, 10, 120, 100, 3)).toBeNull();
  });

  test("hit test follows the node axes (rotated square)", () => {
    const rot = { a: 0.7071, b: 0.7071, c: -0.7071, d: 0.7071, e: 0, f: 0 };
    // Half-side 4 rotated 45deg reaches ~5.6 along screen x but only ~2.8 along the diagonal
    // of an axis-aligned square: a point 5 right hits, 3.5 diagonal misses.
    expect(hitFrameHandle(rot, 100, 100, 5, 0, 4)).toBe("nw");
    expect(hitFrameHandle(rot, 100, 100, 3.5, 3.5, 4)).toBeNull();
  });
});

describe("cursor", () => {
  test("unrotated matches the classic cursors", () => {
    const id = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    expect(frameHandleCursor(id, "n")).toBe("ns-resize");
    expect(frameHandleCursor(id, "e")).toBe("ew-resize");
    expect(frameHandleCursor(id, "nw")).toBe("nwse-resize");
    expect(frameHandleCursor(id, "ne")).toBe("nesw-resize");
  });
  test("rotating 45 degrees turns each cursor by one step", () => {
    const rad = Math.PI / 4;
    const m = {
      a: Math.cos(rad),
      b: Math.sin(rad),
      c: -Math.sin(rad),
      d: Math.cos(rad),
      e: 0,
      f: 0,
    };
    expect(frameHandleCursor(m, "e")).toBe("nwse-resize");
    expect(frameHandleCursor(m, "n")).toBe("nesw-resize");
  });
  test("90 degrees swaps ew and ns", () => {
    const m = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    expect(frameHandleCursor(m, "e")).toBe("ns-resize");
    expect(frameHandleCursor(m, "n")).toBe("ew-resize");
  });
});

describe("label and tag anchors", () => {
  const corners = [
    { x: 10, y: 0 },
    { x: 30, y: 10 },
    { x: 20, y: 30 },
    { x: 0, y: 20 },
  ];
  test("label sits under the lowest point, centered on the span", () =>
    expect(labelAnchor(corners)).toEqual({ x: 15, y: 30 }));
  test("topmost corner", () => expect(topmostCorner(corners)).toEqual({ x: 10, y: 0 }));
});

describe("resizeFrame", () => {
  /** Document position of a point of the resized node (local coords of the NEW size). */
  const docPointAfter = (
    id: string,
    next: ReturnType<typeof resizeFrame>,
    local: { x: number; y: number },
  ) => {
    const f = getSelectionFrame(doc, layout, id)!;
    const p = f.parentMatrix;
    const dx = next.x - f.box.x;
    const dy = next.y - f.box.y;
    const origin = applyAffine(f.matrix, 0, 0);
    const moved = { x: origin.x + p.a * dx + p.c * dy, y: origin.y + p.b * dx + p.d * dy };
    const rel = applyAffine(f.matrix, local.x, local.y);
    return { x: rel.x - origin.x + moved.x, y: rel.y - origin.y + moved.y };
  };

  test("unrotated behaves like resizeBox", () => {
    const f = getSelectionFrame(doc, layout, "plain")!;
    expect(resizeFrame(f, "se", 4, 2)).toEqual({ x: 5, y: 5, width: 24, height: 12 });
    expect(resizeFrame(f, "nw", -4, -2)).toEqual({ x: 1, y: 3, width: 24, height: 12 });
  });

  test("pointer delta is read in the node's local axes", () => {
    // Total rotation 180: dragging "e" right by 4 doc px shrinks the width by 4.
    const f = getSelectionFrame(doc, layout, "r")!;
    expect(resizeFrame(f, "e", 4, 0).width).toBeCloseTo(16);
    expect(resizeFrame(f, "e", -4, 0).width).toBeCloseTo(24);
    expect(resizeFrame(f, "s", 0, -3).height).toBeCloseTo(13);
  });

  test("opposite corner stays fixed on screen (rotated parent + rotated node)", () => {
    const f = getSelectionFrame(doc, layout, "r")!;
    const se = applyAffine(f.matrix, 20, 10);
    const next = resizeFrame(f, "nw", 3, -2);
    expect(next.width).not.toBe(20);
    const after = docPointAfter("r", next, { x: next.width, y: next.height });
    near(after, se.x, se.y);
  });

  test("dragged edge follows the pointer", () => {
    const f = getSelectionFrame(doc, layout, "r")!;
    const e = applyAffine(f.matrix, 20, 5);
    const next = resizeFrame(f, "e", -4, 0);
    // The e edge midpoint moved by exactly the pointer delta (nw edge anchored).
    near(docPointAfter("r", next, { x: next.width, y: next.height / 2 }), e.x - 4, e.y);
  });

  test("alt keeps the center fixed", () => {
    const f = getSelectionFrame(doc, layout, "r")!;
    const center = applyAffine(f.matrix, 10, 5);
    const next = resizeFrame(f, "e", 4, 0, { alt: true });
    near(docPointAfter("r", next, { x: next.width / 2, y: next.height / 2 }), center.x, center.y);
  });

  test("shift keeps aspect ratio in local space", () => {
    const f = getSelectionFrame(doc, layout, "r")!;
    const next = resizeFrame(f, "se", -4, 0, { shift: true });
    expect(next.width / next.height).toBeCloseTo(2);
  });
});
