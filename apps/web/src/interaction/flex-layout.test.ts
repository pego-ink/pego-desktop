/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  computeLayout,
  findNode,
  type PegoDocument,
  type PegoNode,
  type TextMeasurer,
} from "@pego/doc";
import {
  addFlexLayout,
  inferDirection,
  inferGap,
  inferPadding,
  orderAlong,
  removeFlexLayout,
} from "./flex-layout";
import type { StructureResult } from "./structure";

const measure: TextMeasurer = () => ({ width: 100, height: 20 });
const layoutOf = (doc: PegoDocument) => computeLayout(doc, measure);

const rect = (id: string, x: number, y: number, w = 50, h = 50): PegoNode => ({
  type: "rectangle",
  id,
  x,
  y,
  width: w,
  height: h,
});

const docWith = (children: PegoNode[]): PegoDocument =>
  ({
    version: 5,
    id: "d",
    name: "d",
    variables: {},
    children: [{ type: "page", id: "p", name: "Page 1", x: 0, y: 0, children } as PegoNode],
  }) as PegoDocument;

const frame = (extra: Record<string, unknown>, children: PegoNode[]): PegoNode =>
  ({
    type: "frame",
    id: "f",
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    layout: "none",
    ...extra,
    children,
  }) as PegoNode;

const run = (doc: PegoDocument, result: StructureResult) => {
  if ("error" in result) throw new Error(result.error);
  return { doc: applyOps(doc, result.ops).doc, select: result.select };
};

describe("inference helpers", () => {
  const box = (x: number, y: number, width = 50, height = 50) => ({ x, y, width, height });
  test("side by side is horizontal, stacked is vertical", () => {
    expect(inferDirection([box(0, 0), box(60, 0), box(120, 5)])).toBe("horizontal");
    expect(inferDirection([box(0, 0), box(0, 60), box(5, 120)])).toBe("vertical");
    expect(inferDirection([box(0, 0)])).toBe("vertical");
  });
  test("gap is the rounded median, never negative", () => {
    expect(inferGap([box(0, 0), box(58.4, 0), box(116.8, 0)], "horizontal")).toBe(8);
    expect(inferGap([box(0, 0), box(40, 0)], "horizontal")).toBe(0);
    expect(inferGap([box(0, 0)], "vertical")).toBe(0);
  });
  test("padding is the offset of the children's union inside the frame", () => {
    expect(
      inferPadding([box(10, 20), box(70, 20)], { x: 0, y: 0, width: 140, height: 100 }),
    ).toEqual([20, 20, 30, 10]);
  });
  test("orderAlong sorts by position", () => {
    expect(orderAlong([box(100, 0), box(0, 0), box(50, 0)], "horizontal")).toEqual([1, 2, 0]);
  });
});

describe("addFlexLayout", () => {
  test("a frame gets direction, gap and padding; children lose x/y and keep reading order", () => {
    const doc = docWith([frame({}, [rect("b", 80, 10), rect("a", 10, 10)])]);
    const { doc: next, select } = run(doc, addFlexLayout(doc, layoutOf(doc), ["f"]));
    const f = findNode(next, "f");
    expect(select).toEqual(["f"]);
    expect(f).toMatchObject({ layout: "horizontal", gap: 20 });
    expect((f as { padding: unknown }).padding).toEqual([10, 170, 140, 10]);
    expect((f as { children: PegoNode[] }).children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(findNode(next, "a")).toMatchObject({ x: 0, y: 0 });
  });

  test("stacked children give a vertical layout", () => {
    const doc = docWith([frame({}, [rect("a", 10, 10), rect("b", 10, 70)])]);
    const { doc: next } = run(doc, addFlexLayout(doc, layoutOf(doc), ["f"]));
    expect(findNode(next, "f")).toMatchObject({ layout: "vertical", gap: 10 });
  });

  test("refuses a frame that is already laid out", () => {
    const doc = docWith([frame({ layout: "vertical" }, [rect("a", 0, 0)])]);
    expect(addFlexLayout(doc, layoutOf(doc), ["f"])).toHaveProperty("error");
  });

  test("several layers are wrapped in a new hugging flex frame", () => {
    const doc = docWith([rect("b", 120, 0), rect("a", 0, 0)]);
    const { doc: next, select } = run(doc, addFlexLayout(doc, layoutOf(doc), ["a", "b"]));
    const wrapper = findNode(next, select[0]!);
    expect(wrapper).toMatchObject({
      type: "frame",
      layout: "horizontal",
      gap: 70,
      width: "fit_content",
    });
    expect((wrapper as { children: PegoNode[] }).children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(findNode(next, "b")).toMatchObject({ x: 0, y: 0 });
  });

  test("a single non-frame layer is wrapped", () => {
    const doc = docWith([rect("a", 30, 40)]);
    const { doc: next, select } = run(doc, addFlexLayout(doc, layoutOf(doc), ["a"]));
    expect(findNode(next, select[0]!)).toMatchObject({ type: "frame", x: 30, y: 40 });
  });
});

describe("removeFlexLayout", () => {
  test("children keep their computed boxes; hugging sizes become numbers", () => {
    const doc = docWith([
      frame(
        { layout: "horizontal", gap: 10, padding: 20, width: "fit_content", height: "fit_content" },
        [rect("a", 0, 0), { ...rect("b", 0, 0), height: "fill_container" } as PegoNode],
      ),
    ]);
    const layout = layoutOf(doc);
    const { doc: next } = run(doc, removeFlexLayout(doc, layout, ["f"]));
    const after = layoutOf(next);
    expect(findNode(next, "f")).toMatchObject({ layout: "none" });
    for (const id of ["f", "a", "b"]) expect(after.get(id)).toEqual(layout.get(id)!);
    expect(findNode(next, "b")).toMatchObject({ height: layout.get("b")!.height });
  });

  test("refuses a frame without layout", () => {
    const doc = docWith([frame({}, [rect("a", 0, 0)])]);
    expect(removeFlexLayout(doc, layoutOf(doc), ["f"])).toHaveProperty("error");
  });
});
