import { describe, expect, test } from "bun:test";
import {
  applyOp,
  computeLayout,
  findLocation,
  type PageNode,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import {
  childrenAmong,
  insertionLine,
  planDrag,
  reorderOps,
  resolveDropParent,
  slotIndex,
  wouldNestComponent,
} from "./drag-target";

const rect = (id: string, x = 0, y = 0) =>
  ({ type: "rectangle", id, x, y, width: 50, height: 50 }) as const;

const PAGE = "page";

/** A one-page document holding `children` at its top level. */
const onPage = (children: PegoNode[]): PegoDocument => ({
  version: 4,
  id: "d",
  name: "d",
  variables: {},
  children: [{ type: "page", id: PAGE, name: "Page 1", x: 0, y: 0, children }],
});

const top = (doc: PegoDocument): PegoNode[] => doc.children[0]!.children;
const withTop = (doc: PegoDocument, children: PegoNode[]): PegoDocument => ({
  ...doc,
  children: [{ ...(doc.children[0] as PageNode), children }],
});

const makeDoc = (): PegoDocument =>
  onPage([
    {
      type: "frame",
      id: "stage",
      x: 100,
      y: 100,
      width: 300,
      height: 100,
      layout: "horizontal",
      gap: 10,
      children: [rect("a"), rect("b"), rect("c")],
    },
    {
      type: "frame",
      id: "free",
      x: 500,
      y: 20,
      width: 200,
      height: 200,
      layout: "none",
      children: [rect("inner", 10, 20)],
    },
    {
      type: "frame",
      id: "rotated",
      x: 0,
      y: 400,
      width: 200,
      height: 200,
      layout: "none",
      rotation: 90,
      children: [],
    },
    rect("loose", 800, 0),
  ]);

const measure = () => ({ width: 10, height: 10 });
const layoutOf = (doc: PegoDocument) => computeLayout(doc, measure);
const order = (doc: PegoDocument, parentId: string) => {
  const parent = top(doc).find((n) => n.id === parentId);
  return parent && "children" in parent ? parent.children.map((c) => c.id) : [];
};

const run = (
  doc: PegoDocument,
  ids: string[],
  point: { x: number; y: number },
  dx = 0,
  dy = 0,
  startDoc = doc,
  startOps: ReturnType<typeof planDrag>["ops"] = [],
) => {
  const current = startOps.reduce(applyOp, doc);
  const plan = planDrag({
    startDoc,
    startLayout: layoutOf(startDoc),
    doc: current,
    layout: layoutOf(current),
    ids,
    point,
    dx,
    dy,
    snap: false,
  });
  return { plan, next: plan.ops.reduce(applyOp, current) };
};

describe("slotIndex", () => {
  const doc = makeDoc();
  const layout = layoutOf(doc);
  // children at x 100, 160, 220 (width 50, gap 10); midpoints 125, 185, 245
  test("before first midpoint", () =>
    expect(slotIndex(doc, layout, "stage", { x: 110, y: 120 }, new Set(["a"]))).toBe(0));
  test("past a midpoint counts it", () =>
    expect(slotIndex(doc, layout, "stage", { x: 300, y: 120 }, new Set(["a"]))).toBe(2));
  test("excludes dragged nodes", () =>
    expect(slotIndex(doc, layout, "stage", { x: 300, y: 120 }, new Set(["c"]))).toBe(2));
});

describe("reorderOps", () => {
  const doc = makeDoc();
  test("no ops when already at the slot", () =>
    expect(reorderOps(doc, "stage", ["b"], 1)).toEqual([]));
  test("moves a single node to the end", () => {
    const ops = reorderOps(doc, "stage", ["a"], 2);
    expect(order(ops.reduce(applyOp, doc), "stage")).toEqual(["b", "c", "a"]);
  });
  test("moves a block, keeping its order", () => {
    const ops = reorderOps(doc, "stage", ["a", "b"], 1);
    expect(order(ops.reduce(applyOp, doc), "stage")).toEqual(["c", "a", "b"]);
  });
  test("block to the front", () => {
    const ops = reorderOps(doc, "stage", ["b", "c"], 0);
    expect(order(ops.reduce(applyOp, doc), "stage")).toEqual(["b", "c", "a"]);
  });
});

describe("resolveDropParent", () => {
  const doc = makeDoc();
  const layout = layoutOf(doc);
  test("flex parent keeps the node while the pointer is inside its box", () =>
    expect(resolveDropParent(doc, layout, { x: 350, y: 150 }, ["a"], "stage")).toBe("stage"));
  test("leaving the flex parent over a free frame targets that frame", () =>
    expect(resolveDropParent(doc, layout, { x: 600, y: 100 }, ["a"], "stage")).toBe("free"));
  test("empty canvas targets the root", () =>
    expect(resolveDropParent(doc, layout, { x: 1000, y: 1000 }, ["a"], "stage")).toBeNull());
  test("ignores the dragged node itself", () =>
    expect(resolveDropParent(doc, layout, { x: 520, y: 40 }, ["inner"], "free")).toBe("free"));
  test("deepest frame wins", () => {
    const nested: PegoDocument = withTop(doc, [
      {
        type: "frame",
        id: "outer",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        layout: "none",
        children: [
          {
            type: "frame",
            id: "innerFrame",
            x: 50,
            y: 50,
            width: 100,
            height: 100,
            layout: "none",
            children: [],
          },
        ],
      },
      rect("loose", 900, 900),
    ]);
    expect(resolveDropParent(nested, layoutOf(nested), { x: 80, y: 80 }, ["loose"], null)).toBe(
      "innerFrame",
    );
  });
});

describe("wouldNestComponent", () => {
  const doc: PegoDocument = withTop(makeDoc(), [
    { type: "frame", id: "comp", reusable: true, x: 0, y: 0, layout: "none", children: [] },
    { type: "ref", id: "inst", ref: "comp", x: 0, y: 0 },
  ]);
  test("instance into its own component is rejected", () =>
    expect(wouldNestComponent(doc, ["inst"], "comp")).toBe(true));
  test("instance to the root is fine", () =>
    expect(wouldNestComponent(doc, ["inst"], null)).toBe(false));
});

describe("planDrag", () => {
  test("flex child reorders live along the main axis", () => {
    const doc = makeDoc();
    const { plan, next } = run(doc, ["a"], { x: 300, y: 120 }, 190, 0);
    expect(order(next, "stage")).toEqual(["b", "c", "a"]);
    expect(plan.flexParentId).toBe("stage");
  });

  test("dragging back restores the order", () => {
    const doc = makeDoc();
    const first = run(doc, ["a"], { x: 300, y: 120 }, 190, 0);
    const back = run(first.next, ["a"], { x: 110, y: 120 }, 0, 0, doc, first.plan.ops);
    expect(order(back.next, "stage")).toEqual(["a", "b", "c"]);
  });

  test("vertical stage uses y midpoints", () => {
    const doc = makeDoc();
    const vertical: PegoDocument = withTop(
      doc,
      top(doc).map((n) =>
        n.id === "stage" && n.type === "frame" ? { ...n, layout: "vertical", height: 300 } : n,
      ),
    );
    // children at y 100, 160, 220
    const { next } = run(vertical, ["a"], { x: 120, y: 400 - 80 }, 0, 200);
    expect(order(next, "stage")).toEqual(["b", "c", "a"]);
  });

  test("multi-selection of siblings reorders as a block", () => {
    const doc = makeDoc();
    const { next } = run(doc, ["a", "b"], { x: 390, y: 120 }, 280, 0);
    expect(order(next, "stage")).toEqual(["c", "a", "b"]);
  });

  test("flex child dragged onto a free frame keeps its screen position", () => {
    const doc = makeDoc();
    // a sits at doc (100,100); drag by (+450,-50): doc (550,50) = free-local (50,30)
    const { next, plan } = run(doc, ["a"], { x: 575, y: 75 }, 450, -50);
    expect(findLocation(next, "a")?.parentId).toBe("free");
    const a = findLocation(next, "a")?.node;
    expect([a?.x, a?.y]).toEqual([50, 30]);
    expect(plan.flexParentId).toBeNull();
  });

  test("free child dragged out to the root converts to document coords", () => {
    const doc = makeDoc();
    // inner is at doc (510,40); move by (+100,+1000) onto empty canvas
    const { next } = run(doc, ["inner"], { x: 620, y: 1050 }, 100, 1000);
    // The top level of the page the node is on.
    expect(findLocation(next, "inner")?.parentId).toBe(PAGE);
    const inner = findLocation(next, "inner")?.node;
    expect([inner?.x, inner?.y]).toEqual([610, 1040]);
  });

  test("root node dragged into a free frame becomes its child", () => {
    const doc = makeDoc();
    // loose at (800,0); move by (-250, 50) -> doc (550,50); free at (500,20) -> local (50,30)
    const { next } = run(doc, ["loose"], { x: 575, y: 75 }, -250, 50);
    expect(findLocation(next, "loose")?.parentId).toBe("free");
    const loose = findLocation(next, "loose")?.node;
    expect([loose?.x, loose?.y]).toEqual([50, 30]);
  });

  test("root node dragged into an auto-layout frame inserts at the pointer slot", () => {
    const doc = makeDoc();
    const { next, plan } = run(doc, ["loose"], { x: 190, y: 120 }, -600, 120);
    expect(order(next, "stage")).toEqual(["a", "b", "loose", "c"]);
    expect(plan.flexParentId).toBe("stage");
  });

  test("into a rotated frame preserves the on-screen position", () => {
    const doc = makeDoc();
    // rotation 90 ccw about (0,400): local (lx, ly) -> doc (ly, 400 - lx), covering x 0..200, y 200..400.
    // loose origin (800,0) + (-700,300) = doc (100,300) -> local (100,100).
    const { next } = run(doc, ["loose"], { x: 120, y: 320 }, -700, 300);
    expect(findLocation(next, "loose")?.parentId).toBe("rotated");
    const loose = findLocation(next, "loose")?.node;
    expect([loose?.x, loose?.y]).toEqual([100, 100]);
  });

  test("free drag inside its own parent behaves like a plain move", () => {
    const doc = makeDoc();
    const { next } = run(doc, ["inner"], { x: 530, y: 60 }, 10, 5);
    expect(findLocation(next, "inner")?.parentId).toBe("free");
    const inner = findLocation(next, "inner")?.node;
    expect([inner?.x, inner?.y]).toEqual([20, 25]);
  });

  test("mixed-parent selection only moves free nodes", () => {
    const doc = makeDoc();
    const { next } = run(doc, ["a", "inner"], { x: 530, y: 60 }, 10, 5);
    expect(findLocation(next, "a")?.parentId).toBe("stage");
    expect(findLocation(next, "inner")?.node.x).toBe(20);
  });

  test("dropping back onto the original free parent restores the original index", () => {
    const doc = makeDoc();
    const out = run(doc, ["inner"], { x: 620, y: 1050 }, 100, 1000);
    const back = run(out.next, ["inner"], { x: 530, y: 60 }, 10, 5, doc, out.plan.ops);
    expect(findLocation(back.next, "inner")?.parentId).toBe("free");
    expect(findLocation(back.next, "inner")?.node.x).toBe(20);
  });
});

describe("insertionLine", () => {
  const doc = makeDoc();
  const layout = layoutOf(doc);
  test("sits in the gap before a middle child, spanning the frame height", () => {
    expect(insertionLine(doc, layout, "stage", ["b"])).toEqual({
      x1: 155,
      y1: 100,
      x2: 155,
      y2: 200,
    });
  });
  test("first child sits flush on the frame edge", () => {
    expect(insertionLine(doc, layout, "stage", ["a"])).toEqual({
      x1: 100,
      y1: 100,
      x2: 100,
      y2: 200,
    });
  });
  test("null for a non-flex frame", () =>
    expect(insertionLine(doc, layout, "free", ["inner"])).toBeNull());
});

describe("childrenAmong", () => {
  test("keeps document order", () =>
    expect(childrenAmong(makeDoc(), "stage", ["c", "a"])).toEqual(["a", "c"]));
});
