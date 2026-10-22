import { describe, expect, test } from "bun:test";
import { computeLayout, type Box, type Layout, type TextMeasurer } from "./layout";
import { documentSchema, type PegoDocument } from "./schema";

// Deterministic fake: 10px per char, 20px per line, wraps at floor(maxWidth / 10) chars.
const measureText: TextMeasurer = (node, maxWidth) => {
  const length = node.content.length;
  if (maxWidth === undefined) return { width: length * 10, height: 20 };
  const perLine = Math.max(1, Math.floor(maxWidth / 10));
  const lines = Math.max(1, Math.ceil(length / perLine));
  return { width: Math.min(length, perLine) * 10, height: lines * 20 };
};

const makeDoc = (children: unknown[], variables: Record<string, unknown> = {}): PegoDocument =>
  documentSchema.parse({ version: 0, id: "doc", name: "Test", variables, children });

const layoutOf = (children: unknown[], variables?: Record<string, unknown>): Layout =>
  computeLayout(makeDoc(children, variables), measureText);

const box = (layout: Layout, id: string): Box => {
  const found = layout.get(id);
  if (!found) throw new Error(`no box for ${id}`);
  return found;
};

const rect = (id: string, props: Record<string, unknown> = {}) => ({
  type: "rectangle",
  id,
  ...props,
});

describe("computeLayout basics", () => {
  test("top-level nodes sit at their x/y with fixed size", () => {
    const layout = layoutOf([rect("a", { x: 15, y: 25, width: 100, height: 40 })]);
    expect(box(layout, "a")).toEqual({ x: 15, y: 25, width: 100, height: 40 });
  });

  test("shapes without size are 0x0", () => {
    const layout = layoutOf([
      rect("r"),
      { type: "ellipse", id: "e" },
      { type: "path", id: "p", geometry: "M0 0" },
    ]);
    for (const id of ["r", "e", "p"])
      expect(box(layout, id)).toMatchObject({ width: 0, height: 0 });
  });

  test("empty document yields an empty map", () => {
    expect(layoutOf([]).size).toBe(0);
  });

  test("text without width measures a single line", () => {
    const layout = layoutOf([{ type: "text", id: "t", content: "hello" }]);
    expect(box(layout, "t")).toEqual({ x: 0, y: 0, width: 50, height: 20 });
  });

  test("text with numeric width wraps and measures height", () => {
    const layout = layoutOf([{ type: "text", id: "t", content: "abcdefghij", width: 30 }]);
    expect(box(layout, "t")).toEqual({ x: 0, y: 0, width: 30, height: 80 });
  });

  test("numeric text height overrides measured height", () => {
    const layout = layoutOf([
      { type: "text", id: "t", content: "abcdefghij", width: 30, height: 50 },
    ]);
    expect(box(layout, "t").height).toBe(50);
  });
});

describe("layout none and groups", () => {
  test("children keep own x/y relative to the parent", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        x: 100,
        y: 200,
        width: 300,
        height: 300,
        children: [rect("c", { x: 10, y: 20, width: 5, height: 5 })],
      },
    ]);
    expect(box(layout, "c")).toEqual({ x: 110, y: 220, width: 5, height: 5 });
  });

  test("frame without size hugs children extent from 0, ignoring padding", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        padding: 100,
        children: [
          rect("a", { x: 10, y: 20, width: 30, height: 40 }),
          rect("b", { x: 50, y: 5, width: 20, height: 10 }),
        ],
      },
    ]);
    expect(box(layout, "f")).toEqual({ x: 0, y: 0, width: 70, height: 60 });
    expect(box(layout, "a")).toMatchObject({ x: 10, y: 20 });
  });

  test("group hugs children extent and keeps relative positions", () => {
    const layout = layoutOf([
      {
        type: "group",
        id: "g",
        x: 5,
        y: 5,
        children: [
          rect("a", { x: 10, y: 10, width: 10, height: 10 }),
          rect("b", { x: 40, y: 0, width: 10, height: 30 }),
        ],
      },
    ]);
    expect(box(layout, "g")).toEqual({ x: 5, y: 5, width: 50, height: 30 });
    expect(box(layout, "a")).toMatchObject({ x: 15, y: 15 });
    expect(box(layout, "b")).toMatchObject({ x: 45, y: 5 });
  });

  test("empty frame and group hug to 0x0", () => {
    const layout = layoutOf([
      { type: "frame", id: "f" },
      { type: "group", id: "g" },
    ]);
    expect(box(layout, "f")).toMatchObject({ width: 0, height: 0 });
    expect(box(layout, "g")).toMatchObject({ width: 0, height: 0 });
  });

  test("numeric size on a none frame is fixed regardless of children", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        width: 10,
        height: 10,
        children: [rect("a", { width: 500, height: 500 })],
      },
    ]);
    expect(box(layout, "f")).toMatchObject({ width: 10, height: 10 });
  });
});

describe("flex basics", () => {
  test("horizontal hug: sum of widths + gaps + padding, cross is max + padding", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        gap: 10,
        padding: 5,
        children: [
          rect("a", { x: 999, y: 999, width: 20, height: 30 }),
          rect("b", { width: 40, height: 10 }),
        ],
      },
    ]);
    expect(box(layout, "f")).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    expect(box(layout, "a")).toEqual({ x: 5, y: 5, width: 20, height: 30 });
    expect(box(layout, "b")).toEqual({ x: 35, y: 5, width: 40, height: 10 });
  });

  test("vertical hug with [top, right, bottom, left] padding", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "vertical",
        gap: 4,
        padding: [1, 2, 3, 4],
        children: [rect("a", { width: 10, height: 10 }), rect("b", { width: 30, height: 6 })],
      },
    ]);
    // width = 30 + left 4 + right 2; height = 10 + 6 + gap 4 + top 1 + bottom 3
    expect(box(layout, "f")).toEqual({ x: 0, y: 0, width: 36, height: 24 });
    expect(box(layout, "a")).toMatchObject({ x: 4, y: 1 });
    expect(box(layout, "b")).toMatchObject({ x: 4, y: 15 });
  });

  test("$variable gap and padding resolve", () => {
    const layout = layoutOf(
      [
        {
          type: "frame",
          id: "f",
          layout: "horizontal",
          gap: "$g",
          padding: ["$p", 0, 0, "$p"],
          children: [rect("a", { width: 10, height: 10 }), rect("b", { width: 10, height: 10 })],
        },
      ],
      { g: { type: "number", value: 8 }, p: { type: "number", value: 6 } },
    );
    expect(box(layout, "b")).toMatchObject({ x: 6 + 10 + 8, y: 6 });
    expect(box(layout, "f")).toMatchObject({ width: 6 + 28, height: 16 });
  });

  test("fit_content behaves like hug", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: "fit_content",
        height: "fit_content",
        children: [rect("a", { width: 10, height: 20 }), rect("b", { width: 5, height: 7 })],
      },
    ]);
    expect(box(layout, "f")).toMatchObject({ width: 15, height: 20 });
  });

  test("fixed frame size is not changed by children", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 50,
        height: 50,
        children: [rect("a", { width: 100, height: 100 })],
      },
    ]);
    expect(box(layout, "f")).toMatchObject({ width: 50, height: 50 });
  });

  test("flex frame with no children and padding hugs to padding", () => {
    const layout = layoutOf([{ type: "frame", id: "f", layout: "horizontal", padding: 5 }]);
    expect(box(layout, "f")).toMatchObject({ width: 10, height: 10 });
  });
});

describe("fill_container", () => {
  test("main axis: remaining space split equally among fill children", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 200,
        height: 50,
        padding: 10,
        gap: 10,
        children: [
          rect("a", { width: 50, height: 10 }),
          rect("b", { width: "fill_container", height: 10 }),
          rect("c", { width: "fill_container", height: 10 }),
        ],
      },
    ]);
    // inner 180 - 50 - 2 gaps (20) = 110 -> 55 each
    expect(box(layout, "b")).toEqual({ x: 70, y: 10, width: 55, height: 10 });
    expect(box(layout, "c")).toEqual({ x: 135, y: 10, width: 55, height: 10 });
  });

  test("fill share is never negative", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 40,
        height: 10,
        children: [
          rect("a", { width: 100, height: 10 }),
          rect("b", { width: "fill_container", height: 10 }),
        ],
      },
    ]);
    expect(box(layout, "b").width).toBe(0);
  });

  test("vertical main axis fills height", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "vertical",
        width: 20,
        height: 100,
        children: [
          rect("a", { width: 5, height: 40 }),
          rect("b", { width: 5, height: "fill_container" }),
        ],
      },
    ]);
    expect(box(layout, "b")).toEqual({ x: 0, y: 40, width: 5, height: 60 });
  });

  test("cross axis stretches to inner cross size", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 100,
        height: 100,
        padding: 10,
        children: [rect("a", { width: 10, height: "fill_container" })],
      },
    ]);
    expect(box(layout, "a")).toEqual({ x: 10, y: 10, width: 10, height: 80 });
  });

  test("text with fill width wraps at the given width", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 100,
        children: [
          { type: "text", id: "t", content: "abcdefghijklmnopqrst", width: "fill_container" },
        ],
      },
    ]);
    expect(box(layout, "t")).toMatchObject({ width: 100, height: 40 });
    expect(box(layout, "f").height).toBe(40);
  });

  test("fill child in a hugging parent hugs, then fills the final cross size", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "vertical",
        children: [
          rect("a", { width: 100, height: 20 }),
          rect("b", { width: "fill_container", height: 10 }),
        ],
      },
    ]);
    expect(box(layout, "f")).toMatchObject({ width: 100, height: 30 });
    expect(box(layout, "b")).toEqual({ x: 0, y: 20, width: 100, height: 10 });
  });

  test("fill main child in a hugging parent contributes its hug size to the parent", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        children: [
          rect("a", { width: 10, height: 10 }),
          { type: "text", id: "t", content: "abc", width: "fill_container" },
        ],
      },
    ]);
    expect(box(layout, "f").width).toBe(40);
    expect(box(layout, "t")).toMatchObject({ x: 10, width: 30 });
  });

  test("fill in a none frame fills the frame's size", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "f",
        width: 80,
        height: 60,
        children: [rect("a", { width: "fill_container", height: "fill_container" })],
      },
    ]);
    expect(box(layout, "a")).toEqual({ x: 0, y: 0, width: 80, height: 60 });
  });
});

describe("justifyContent and alignItems", () => {
  const row = (extra: Record<string, unknown>) =>
    layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 100,
        height: 50,
        ...extra,
        children: [rect("a", { width: 10, height: 10 }), rect("b", { width: 10, height: 10 })],
      },
    ]);

  test("start", () => {
    const l = row({ justifyContent: "start" });
    expect([box(l, "a").x, box(l, "b").x]).toEqual([0, 10]);
  });

  test("center", () => {
    const l = row({ justifyContent: "center" });
    expect([box(l, "a").x, box(l, "b").x]).toEqual([40, 50]);
  });

  test("end", () => {
    const l = row({ justifyContent: "end" });
    expect([box(l, "a").x, box(l, "b").x]).toEqual([80, 90]);
  });

  test("space_between", () => {
    const l = row({ justifyContent: "space_between" });
    expect([box(l, "a").x, box(l, "b").x]).toEqual([0, 90]);
  });

  test("space_around: equal space around each item, half at the edges", () => {
    const l = row({ justifyContent: "space_around" });
    // free 80 / 2 items = 40 per item, 20 on each side
    expect([box(l, "a").x, box(l, "b").x]).toEqual([20, 70]);
  });

  test("space_between with a single child behaves like start", () => {
    const l = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "horizontal",
        width: 100,
        height: 10,
        justifyContent: "space_between",
        children: [rect("a", { width: 10, height: 10 })],
      },
    ]);
    expect(box(l, "a").x).toBe(0);
  });

  test("justify accounts for gap and padding", () => {
    const l = row({ justifyContent: "end", gap: 10, padding: 5 });
    // inner 90, used 30 -> free 60; start 5 + 60
    expect([box(l, "a").x, box(l, "b").x]).toEqual([65, 85]);
  });

  test("alignItems start/center/end on the cross axis", () => {
    expect(box(row({ alignItems: "start" }), "a").y).toBe(0);
    expect(box(row({ alignItems: "center" }), "a").y).toBe(20);
    expect(box(row({ alignItems: "end" }), "a").y).toBe(40);
  });

  test("alignItems in a vertical frame aligns horizontally", () => {
    const l = layoutOf([
      {
        type: "frame",
        id: "f",
        layout: "vertical",
        width: 100,
        height: 100,
        alignItems: "end",
        justifyContent: "center",
        children: [rect("a", { width: 10, height: 10 })],
      },
    ]);
    expect(box(l, "a")).toEqual({ x: 90, y: 45, width: 10, height: 10 });
  });
});

describe("nested flex", () => {
  test("vertical column of horizontal rows with fill children", () => {
    const rowOf = (id: string) => ({
      type: "frame",
      id,
      layout: "horizontal",
      width: "fill_container",
      height: 30,
      children: [
        rect(`${id}a`, { width: "fill_container", height: "fill_container" }),
        rect(`${id}b`, { width: "fill_container", height: "fill_container" }),
      ],
    });
    const layout = layoutOf([
      {
        type: "frame",
        id: "col",
        x: 50,
        y: 70,
        layout: "vertical",
        width: 200,
        padding: 10,
        gap: 10,
        children: [rowOf("r1"), rowOf("r2")],
      },
    ]);
    expect(box(layout, "col")).toEqual({ x: 50, y: 70, width: 200, height: 90 });
    expect(box(layout, "r1")).toEqual({ x: 60, y: 80, width: 180, height: 30 });
    expect(box(layout, "r1a")).toEqual({ x: 60, y: 80, width: 90, height: 30 });
    expect(box(layout, "r1b")).toEqual({ x: 150, y: 80, width: 90, height: 30 });
    expect(box(layout, "r2")).toEqual({ x: 60, y: 120, width: 180, height: 30 });
    expect(box(layout, "r2b")).toEqual({ x: 150, y: 120, width: 90, height: 30 });
  });

  test("hugging column of hugging rows places rows by their hugged size", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "col",
        layout: "vertical",
        gap: 5,
        children: [
          {
            type: "frame",
            id: "r1",
            layout: "horizontal",
            gap: 2,
            children: [rect("a", { width: 10, height: 10 }), rect("b", { width: 10, height: 20 })],
          },
          {
            type: "frame",
            id: "r2",
            layout: "horizontal",
            children: [rect("c", { width: 30, height: 10 })],
          },
        ],
      },
    ]);
    expect(box(layout, "col")).toEqual({ x: 0, y: 0, width: 30, height: 35 });
    expect(box(layout, "r1")).toMatchObject({ x: 0, y: 0, width: 22, height: 20 });
    expect(box(layout, "b")).toMatchObject({ x: 12, y: 0 });
    expect(box(layout, "r2")).toMatchObject({ x: 0, y: 25 });
    expect(box(layout, "c")).toMatchObject({ x: 0, y: 25 });
  });
});

describe("ref instances", () => {
  const component = {
    type: "frame",
    id: "comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    children: [
      rect("r", { x: 5, y: 6, width: 10, height: 10 }),
      { type: "text", id: "t", x: 20, y: 0, content: "hi" },
    ],
  };

  test("instance root has the ref's id, x/y and size overrides", () => {
    const layout = layoutOf([
      component,
      { type: "ref", id: "i1", ref: "comp", x: 200, y: 300, width: 150 },
    ]);
    expect(box(layout, "i1")).toEqual({ x: 200, y: 300, width: 150, height: 50 });
  });

  test("descendants get ids <refId>/<componentChildId> with absolute positions", () => {
    const layout = layoutOf([component, { type: "ref", id: "i1", ref: "comp", x: 200, y: 300 }]);
    expect(box(layout, "i1/r")).toEqual({ x: 205, y: 306, width: 10, height: 10 });
    expect(box(layout, "i1/t")).toEqual({ x: 220, y: 300, width: 20, height: 20 });
    // the component itself is still rendered at its own place
    expect(box(layout, "comp")).toMatchObject({ x: 0, y: 0 });
  });

  test("descendants override changes measured size", () => {
    const layout = layoutOf([
      component,
      {
        type: "ref",
        id: "i1",
        ref: "comp",
        descendants: { t: { content: "hello world" } },
      },
    ]);
    expect(box(layout, "i1/t")).toMatchObject({ width: 110, height: 20 });
    expect(box(layout, "t")).toMatchObject({ width: 20 });
  });

  test("ref to a missing node is absent", () => {
    const layout = layoutOf([{ type: "ref", id: "i1", ref: "nope" }]);
    expect(layout.has("i1")).toBe(false);
    expect(layout.size).toBe(0);
  });

  test("ref to a non-reusable node is absent", () => {
    const layout = layoutOf([
      rect("plain", { width: 10, height: 10 }),
      { type: "ref", id: "i1", ref: "plain" },
    ]);
    expect(layout.has("i1")).toBe(false);
    expect(layout.has("plain")).toBe(true);
  });

  test("flex parent places a ref instance by its size", () => {
    const layout = layoutOf([
      component,
      {
        type: "frame",
        id: "row",
        x: 0,
        y: 400,
        layout: "horizontal",
        gap: 10,
        children: [rect("a", { width: 20, height: 20 }), { type: "ref", id: "i1", ref: "comp" }],
      },
    ]);
    expect(box(layout, "i1")).toEqual({ x: 30, y: 400, width: 100, height: 50 });
    expect(box(layout, "i1/r")).toMatchObject({ x: 35, y: 406 });
  });

  test("component containing a ref to itself does not hang", () => {
    const layout = layoutOf([
      {
        type: "frame",
        id: "self",
        reusable: true,
        width: 10,
        height: 10,
        children: [{ type: "ref", id: "inner", ref: "self" }],
      },
      { type: "ref", id: "i", ref: "self", x: 7, y: 8 },
    ]);
    expect(box(layout, "i")).toMatchObject({ x: 7, y: 8, width: 10, height: 10 });
    expect(layout.size).toBeGreaterThan(1);
    expect(layout.size).toBeLessThan(200);
  });
});

describe("performance", () => {
  test("~2000 nodes in nested flex frames lay out in well under a second", () => {
    const cell = (id: string) => ({
      type: "frame",
      id,
      layout: "horizontal",
      width: "fill_container",
      gap: 4,
      padding: 2,
      children: [
        rect(`${id}-r`, { width: "fill_container", height: 10 }),
        { type: "text", id: `${id}-t`, content: "lorem ipsum", width: "fill_container" },
        rect(`${id}-s`, { width: 8, height: 8 }),
      ],
    });
    // 10 columns x 40 cells x (1 frame + 3 leaves) = 1600, + wrappers
    const columns = Array.from({ length: 10 }, (_, c) => ({
      type: "frame",
      id: `col${c}`,
      layout: "vertical",
      width: 300,
      gap: 2,
      children: Array.from({ length: 50 }, (_, i) => cell(`c${c}-${i}`)),
    }));
    const doc = makeDoc([{ type: "frame", id: "root", layout: "horizontal", children: columns }]);
    const start = performance.now();
    const layout = computeLayout(doc, measureText);
    const elapsed = performance.now() - start;
    expect(layout.size).toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(1000);
  });
});
