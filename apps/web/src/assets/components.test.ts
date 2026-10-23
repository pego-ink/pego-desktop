/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOp, findNode, type PegoDocument } from "@pego/doc";
import { instanceOp, listComponents } from "./components";

const doc: PegoDocument = {
  version: 4,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "p1",
      name: "Home",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "f",
          x: 0,
          y: 0,
          layout: "none",
          children: [{ type: "rectangle", id: "card", name: "Card", x: 0, y: 0, reusable: true }],
        },
      ],
    },
    {
      type: "page",
      id: "p2",
      name: "Components",
      x: 0,
      y: 0,
      children: [{ type: "text", id: "btn", content: "Go", x: 0, y: 0, reusable: true }],
    },
  ],
};

describe("listComponents", () => {
  test("finds reusable nodes on every page, nested ones too", () => {
    expect(listComponents(doc)).toEqual([
      { id: "card", name: "Card", pageId: "p1", pageName: "Home" },
      { id: "btn", name: "text", pageId: "p2", pageName: "Components" },
    ]);
  });
});

describe("instanceOp", () => {
  test("inserts a named ref on the page at a rounded position", () => {
    const op = instanceOp({ id: "btn", name: "Button" }, "p1", { x: 10.4, y: 20.6 });
    const next = applyOp(doc, op);
    expect(findNode(next, op.node.id)).toMatchObject({
      type: "ref",
      ref: "btn",
      name: "Button",
      x: 10,
      y: 21,
    });
  });
});
