/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOp, findNode, type PegoDocument } from "@pego/doc";
import { instanceOp, listComponents } from "./components";

const doc: PegoDocument = {
  version: 0,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "frame",
      id: "f",
      x: 0,
      y: 0,
      layout: "none",
      children: [{ type: "rectangle", id: "card", name: "Card", x: 0, y: 0, reusable: true }],
    },
    { type: "text", id: "btn", content: "Go", x: 0, y: 0, reusable: true },
  ],
} as PegoDocument;

describe("listComponents", () => {
  test("finds reusable nodes, nested ones too", () => {
    expect(listComponents(doc)).toEqual([
      { id: "card", name: "Card" },
      { id: "btn", name: "text" },
    ]);
  });
});

describe("instanceOp", () => {
  test("inserts a named ref at the top level at a rounded position", () => {
    const op = instanceOp({ id: "btn", name: "Button" }, { x: 10.4, y: 20.6 });
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
