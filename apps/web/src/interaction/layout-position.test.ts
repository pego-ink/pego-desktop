import { describe, expect, test } from "bun:test";
import { applyOp, computeLayout, findNode, type PegoDocument } from "@pego/doc";
import { flexChildren, layoutPositionOps } from "./layout-position";

const doc: PegoDocument = {
  version: 9,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "page",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "col",
          x: 100,
          y: 50,
          width: 200,
          layout: "vertical",
          padding: 10,
          gap: 8,
          children: [
            { type: "rectangle", id: "a", x: 0, y: 0, width: 40, height: 40 },
            { type: "rectangle", id: "b", x: 0, y: 0, width: 40, height: 40 },
          ],
        },
        { type: "rectangle", id: "loose", x: 0, y: 0, width: 10, height: 10 },
      ],
    },
  ],
};
const measure = () => ({ width: 0, height: 0 });

describe("layoutPositionOps", () => {
  test("only children of flex frames take the setting", () => {
    expect(flexChildren(doc, ["a", "loose", "col"])).toEqual(["a"]);
  });

  test("going absolute keeps the layer where the layout drew it", () => {
    const ops = layoutPositionOps(doc, computeLayout(doc, measure), ["b", "loose"], true);
    const next = ops.reduce(applyOp, doc);
    expect(findNode(next, "b")).toMatchObject({ layoutPosition: "absolute", x: 10, y: 58 });
    expect(findNode(next, "loose")).not.toHaveProperty("layoutPosition");
    expect(computeLayout(next, measure).get("b")).toMatchObject({ x: 110, y: 108 });
  });

  test("going back to auto removes the prop", () => {
    const absolute = layoutPositionOps(doc, computeLayout(doc, measure), ["b"], true).reduce(
      applyOp,
      doc,
    );
    const back = layoutPositionOps(absolute, computeLayout(absolute, measure), ["b"], false);
    expect(findNode(back.reduce(applyOp, absolute), "b")).not.toHaveProperty("layoutPosition");
  });
});
