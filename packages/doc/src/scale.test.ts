import { describe, expect, test } from "bun:test";
import { applyOps } from "./ops";
import { scaleSubtreeOps } from "./scale";
import { documentSchema, type PegoDocument } from "./schema";
import { findNode } from "./tree";
import type { Layout } from "./layout";

const makeDoc = (children: unknown[], variables: Record<string, unknown> = {}): PegoDocument =>
  documentSchema.parse({
    version: 8,
    id: "doc",
    name: "Test",
    variables,
    children: [{ type: "page", id: "page-1", name: "Page 1", children }],
  });

const group = (children: unknown[], props: Record<string, unknown> = {}) => ({
  type: "group",
  id: "g",
  x: 10,
  y: 20,
  ...props,
  children,
});

const noLayout: Layout = new Map();

const propsOf = (ops: ReturnType<typeof scaleSubtreeOps>, id: string) => {
  const op = ops.find((o) => o.op === "update" && o.id === id);
  return op && op.op === "update" ? op.props : undefined;
};

describe("scaleSubtreeOps", () => {
  test("uniform x2 scales shapes, text and nested groups; root untouched", () => {
    const doc = makeDoc([
      group(
        [
          {
            type: "rectangle",
            id: "r",
            x: 5,
            y: 6,
            width: 20,
            height: 10,
            cornerRadius: 4,
            stroke: { color: "#000", width: 2 },
            effects: [
              { type: "shadow", color: "#000", x: 1, y: 2, blur: 3, spread: 1 },
              { type: "blur", radius: 4 },
            ],
          },
          { type: "ellipse", id: "e", x: 1, y: 1, width: 8, height: 8 },
          { type: "text", id: "t", x: 0, y: 0, content: "hi", fontSize: 12, letterSpacing: 1 },
          { type: "group", id: "g2", x: 30, y: 40, children: [] },
        ],
        { width: 100, height: 100 },
      ),
    ]);
    const ops = scaleSubtreeOps(doc, noLayout, "g", 2, 2);
    expect(propsOf(ops, "g")).toBeUndefined();
    expect(propsOf(ops, "r")).toEqual({
      x: 10,
      y: 12,
      width: 40,
      height: 20,
      cornerRadius: 8,
      stroke: { color: "#000", width: 4 },
      effects: [
        { type: "shadow", color: "#000", x: 2, y: 4, blur: 6, spread: 2 },
        { type: "blur", radius: 8 },
      ],
    });
    expect(propsOf(ops, "e")).toEqual({ x: 2, y: 2, width: 16, height: 16 });
    expect(propsOf(ops, "t")).toEqual({ fontSize: 24, letterSpacing: 2 });
    expect(propsOf(ops, "g2")).toEqual({ x: 60, y: 80 });
  });

  test("non-uniform uses axes; axis-less lengths use the geometric mean", () => {
    const doc = makeDoc([
      group([
        {
          type: "rectangle",
          id: "r",
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          cornerRadius: 8,
          stroke: { color: "#000", width: [1, 2, 3, 4] },
          effects: [{ type: "shadow", color: "#000", x: 2, y: 2, blur: 2 }],
        },
      ]),
    ]);
    const p = propsOf(scaleSubtreeOps(doc, noLayout, "g", 4, 1), "r");
    expect(p?.x).toBe(40);
    expect(p?.y).toBe(10);
    expect(p?.width).toBe(80);
    expect(p?.height).toBe(20);
    expect(p?.cornerRadius).toBe(16);
    expect((p?.stroke as { width: number[] }).width).toEqual([1, 8, 3, 16]);
    expect(p?.effects).toEqual([{ type: "shadow", color: "#000", x: 8, y: 2, blur: 4 }]);
  });

  test("frame padding and gap; single padding splits when non-uniform", () => {
    const doc = makeDoc([
      group([
        {
          type: "frame",
          id: "f",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          layout: "horizontal",
          gap: 10,
          padding: 8,
          children: [{ type: "rectangle", id: "c", x: 5, y: 5, width: 10, height: 10 }],
        },
        {
          type: "frame",
          id: "f2",
          x: 0,
          y: 0,
          layout: "vertical",
          gap: 10,
          padding: [1, 2, 3, 4],
          children: [],
        },
      ]),
    ]);
    const uniform = scaleSubtreeOps(doc, noLayout, "g", 2, 2);
    expect(propsOf(uniform, "f")).toMatchObject({ gap: 20, padding: 16, width: 200, height: 200 });
    const skew = scaleSubtreeOps(doc, noLayout, "g", 3, 2);
    expect(propsOf(skew, "f")).toMatchObject({ gap: 30, padding: [16, 24, 16, 24] });
    expect(propsOf(skew, "f2")).toMatchObject({ gap: 20, padding: [2, 6, 6, 12] });
    expect(propsOf(skew, "f2")?.width).toBeUndefined();
  });

  test("flex children keep x/y but their size scales", () => {
    const doc = makeDoc([
      group([
        {
          type: "frame",
          id: "f",
          layout: "vertical",
          children: [{ type: "rectangle", id: "c", x: 5, y: 5, width: 10, height: 10 }],
        },
      ]),
    ]);
    expect(propsOf(scaleSubtreeOps(doc, noLayout, "g", 2, 2), "c")).toEqual({
      width: 20,
      height: 20,
    });
  });

  test("paths get a viewBox from their original size; an existing one is kept", () => {
    const doc = makeDoc([
      group([
        { type: "path", id: "p", x: 0, y: 0, width: 24, height: 12, geometry: "M0 0L24 12" },
        {
          type: "path",
          id: "q",
          x: 0,
          y: 0,
          width: 24,
          height: 12,
          viewBox: [0, 0, 48, 24],
          geometry: "M0 0L48 24",
        },
        { type: "path", id: "u", x: 0, y: 0, geometry: "M0 0L1 1" },
      ]),
    ]);
    const ops = scaleSubtreeOps(doc, noLayout, "g", 2, 3);
    expect(propsOf(ops, "p")).toEqual({ viewBox: [0, 0, 24, 12], width: 48, height: 36 });
    expect(propsOf(ops, "q")).toEqual({ width: 48, height: 36 });
    expect(propsOf(ops, "u")).toBeUndefined();
  });

  test("refs without a numeric size take it from the layout", () => {
    const doc = makeDoc([
      { type: "rectangle", id: "comp", reusable: true, width: 10, height: 10 },
      group([{ type: "ref", id: "i", ref: "comp", x: 4, y: 4 }]),
    ]);
    const layout: Layout = new Map([["i", { x: 14, y: 24, width: 10, height: 10 }]]);
    expect(propsOf(scaleSubtreeOps(doc, layout, "g", 2, 3), "i")).toEqual({
      x: 8,
      y: 12,
      width: 20,
      height: 30,
    });
  });

  test("variables and fit/fill keywords are left alone", () => {
    const doc = makeDoc(
      [
        group([
          {
            type: "rectangle",
            id: "r",
            x: "$pos",
            width: "fill_container",
            height: "fit_content",
            cornerRadius: "$r",
          },
        ]),
      ],
      { pos: { type: "number", value: 3 }, r: { type: "number", value: 4 } },
    );
    expect(scaleSubtreeOps(doc, noLayout, "g", 2, 2)).toEqual([]);
  });

  test("never produces zero sizes or invalid scales", () => {
    const doc = makeDoc([group([{ type: "rectangle", id: "r", width: 10, height: 10 }])]);
    expect(propsOf(scaleSubtreeOps(doc, noLayout, "g", 0.01, 0.01), "r")).toEqual({
      width: 1,
      height: 1,
    });
    expect(scaleSubtreeOps(doc, noLayout, "g", 0, 1)).toEqual([]);
    expect(scaleSubtreeOps(doc, noLayout, "g", Number.NaN, 1)).toEqual([]);
    expect(scaleSubtreeOps(doc, noLayout, "missing", 2, 2)).toEqual([]);
  });

  test("scale x2 then x0.5 restores the numbers", () => {
    const doc = makeDoc([
      group([
        {
          type: "rectangle",
          id: "r",
          x: 5.5,
          y: 7,
          width: 21,
          height: 13,
          cornerRadius: 3,
          stroke: { color: "#000", width: 2 },
        },
        { type: "text", id: "t", x: 1, y: 2, content: "x", fontSize: 14 },
      ]),
    ]);
    const up = applyOps(doc, scaleSubtreeOps(doc, noLayout, "g", 2, 2)).doc;
    const down = applyOps(up, scaleSubtreeOps(up, noLayout, "g", 0.5, 0.5)).doc;
    expect(findNode(down, "r")).toEqual(findNode(doc, "r") as never);
    expect(findNode(down, "t")).toEqual(findNode(doc, "t") as never);
  });
});
