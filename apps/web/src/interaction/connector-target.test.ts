import { describe, expect, test } from "bun:test";
import { applyOp, computeLayout, findNode, type PegoDocument } from "@pego/doc";
import { connectEndAt, connectOp } from "./connector-target";

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
          id: "login",
          name: "Login",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
          layout: "none",
          children: [
            {
              type: "frame",
              id: "btn",
              name: "Masuk",
              x: 20,
              y: 700,
              width: 350,
              height: 52,
              layout: "none",
              children: [{ type: "text", id: "label", x: 10, y: 10, content: "Masuk" }],
            },
          ],
        },
        {
          type: "frame",
          id: "home",
          name: "Beranda",
          x: 470,
          y: 0,
          width: 390,
          height: 844,
          layout: "none",
          children: [],
        },
      ],
    },
  ],
};
const layout = computeLayout(doc, () => ({ width: 40, height: 20 }));

describe("connectEndAt", () => {
  test("the screen under the point by default, the innermost frame with deep", () => {
    expect(connectEndAt(doc, layout, { x: 35, y: 715 })).toBe("login");
    expect(connectEndAt(doc, layout, { x: 35, y: 715 }, { deep: true })).toBe("btn");
    expect(connectEndAt(doc, layout, { x: 500, y: 100 }, { deep: true })).toBe("home");
    expect(connectEndAt(doc, layout, { x: 430, y: 100 })).toBeNull();
  });

  test("connectOp adds a named connector on top of the page", () => {
    const made = connectOp(doc, "page", "btn", "home");
    const next = applyOp(doc, made!.op);
    expect(findNode(next, made!.id)).toMatchObject({
      type: "connector",
      name: "Masuk → Beranda",
      from: { id: "btn" },
      to: { id: "home" },
    });
    expect(next.children[0]!.children.at(-1)?.id).toBe(made!.id);
    expect(connectOp(doc, "page", "home", "home")).toBeNull();
  });
});
