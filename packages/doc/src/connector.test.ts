import { describe, expect, test } from "bun:test";
import {
  connectorGeometry,
  danglingConnectors,
  distanceToPolyline,
  facingSide,
  midpointOf,
} from "./connector";
import { cloneAllWithFreshIds } from "./id";
import { computeLayout } from "./layout";
import { documentSchema, type PegoDocument } from "./schema";

const box = (x: number, y: number, width = 100, height = 200) => ({ x, y, width, height });
// Two phone screens side by side, 200 apart.
const left = box(0, 0);
const right = box(300, 0);

describe("connectorGeometry", () => {
  test("auto sides face each other: side by side uses right/left, stacked uses bottom/top", () => {
    expect(facingSide(left, right)).toBe("right");
    expect(facingSide(right, left)).toBe("left");
    expect(facingSide(box(0, 0), box(0, 400))).toBe("bottom");
    expect(facingSide(box(0, 400), box(0, 0))).toBe("top");
  });

  test("a straight line runs between the facing side middles", () => {
    const { points, mid, bounds } = connectorGeometry(left, right, { route: "straight" });
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ]);
    expect(mid).toEqual({ x: 200, y: 100 });
    expect(bounds).toEqual({ x: 100, y: 100, width: 200, height: 0 });
  });

  test("an elbow turns halfway between two offset boxes, with rounded corners", () => {
    const { points, d } = connectorGeometry(left, box(300, 300));
    // Side by side wins (gap 200 vs 100): out right, down at x 200, in from the left.
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 400 },
      { x: 300, y: 400 },
    ]);
    expect(d).toBe("M 100 100 L 192 100 Q 200 100 200 108 L 200 392 Q 200 400 208 400 L 300 400");
  });

  test("level boxes give one straight elbow segment", () => {
    expect(connectorGeometry(left, right).points).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ]);
  });

  test("fixed sides are kept, with one corner when both legs go forward", () => {
    const { points } = connectorGeometry(left, box(300, 300), { fromSide: "right", toSide: "top" });
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 350, y: 100 },
      { x: 350, y: 300 },
    ]);
  });

  test("going back out of the same side routes around, below level boxes", () => {
    const { points } = connectorGeometry(left, right, { fromSide: "right", toSide: "right" });
    expect(points[0]).toEqual({ x: 100, y: 100 });
    expect(points.at(-1)).toEqual({ x: 400, y: 100 });
    expect(Math.max(...points.map((p) => p.y))).toBe(224);
  });

  test("a curve leaves and enters along the side normals", () => {
    const { d, points } = connectorGeometry(left, box(300, 300), { route: "curved" });
    expect(d.startsWith("M 100 100 C ")).toBe(true);
    expect(points[0]).toEqual({ x: 100, y: 100 });
    expect(points.at(-1)).toEqual({ x: 300, y: 400 });
  });

  test("helpers: midpoint and distance to the line", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(midpointOf(line)).toEqual({ x: 10, y: 0 });
    expect(distanceToPolyline({ x: 5, y: 3 }, line)).toBe(3);
    expect(distanceToPolyline({ x: 14, y: 5 }, line)).toBe(4);
  });
});

const doc = (connector: Record<string, unknown>, extra: unknown[] = []): PegoDocument =>
  documentSchema.parse({
    version: 9,
    id: "d",
    name: "d",
    variables: {},
    children: [
      {
        type: "page",
        id: "p",
        children: [
          {
            type: "frame",
            id: "a",
            x: 0,
            y: 0,
            width: 100,
            height: 200,
            children: [{ type: "rectangle", id: "btn", x: 10, y: 150, width: 80, height: 30 }],
          },
          { type: "frame", id: "b", x: 300, y: 0, width: 100, height: 200 },
          ...extra,
          { type: "connector", id: "c", ...connector },
        ],
      },
    ],
  });

describe("connectors in the layout", () => {
  const measure = () => ({ width: 0, height: 0 });

  test("a connector's box is its line, wherever its ends are", () => {
    const layout = computeLayout(doc({ from: { id: "a" }, to: { id: "b" } }), measure);
    expect(layout.get("c")).toEqual({ x: 100, y: 100, width: 200, height: 0 });
    // From a button inside a screen: out of the button's right side.
    const fromButton = computeLayout(doc({ from: { id: "btn" }, to: { id: "b" } }), measure);
    expect(fromButton.get("c")).toMatchObject({ x: 90, y: 100, width: 210, height: 65 });
  });

  test("a connector with a missing end has no box", () => {
    const layout = computeLayout(doc({ from: { id: "a" }, to: { id: "gone" } }), measure);
    expect(layout.has("c")).toBe(false);
  });

  test("deleting an end (or its screen) takes the connector with it", () => {
    const d = doc({ from: { id: "btn" }, to: { id: "b" } });
    expect(danglingConnectors(d, ["a"])).toEqual(["c"]);
    expect(danglingConnectors(d, ["b"])).toEqual(["c"]);
    expect(danglingConnectors(d, ["c", "b"])).toEqual([]);
    expect(danglingConnectors(d, ["btn2"])).toEqual([]);
  });
});

describe("copying connectors", () => {
  test("a connector copied with its ends points at the copies; other ends stay", () => {
    const d = doc({ from: { id: "a" }, to: { id: "b" } });
    const [a, b, c] = d.children[0]!.children as [never, never, never];
    const [a2, , c2] = cloneAllWithFreshIds([a, b, c]);
    expect(c2).toMatchObject({ type: "connector" });
    const copy = c2 as unknown as { from: { id: string }; to: { id: string } };
    expect(copy.from.id).toBe(a2!.id);
    expect(copy.from.id).not.toBe("a");
    const [alone] = cloneAllWithFreshIds([c]) as unknown as [{ from: { id: string } }];
    expect(alone.from.id).toBe("a");
  });
});
