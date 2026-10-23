/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOp, findNode, type PegoDocument } from "@pego/doc";
import { componentSections, dropInstanceOp, instanceOp, listComponents } from "./components";

const doc: PegoDocument = {
  version: 5,
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

describe("assets panel", () => {
  const withLibrary: PegoDocument = {
    ...doc,
    children: [
      ...doc.children,
      {
        type: "page",
        id: "lib",
        name: "Library · Kit",
        x: 0,
        y: 0,
        library: { projectId: "kit", name: "Kit", path: "/kit/project.pego", syncedAt: 1 },
        children: [
          { type: "rectangle", id: "chip", name: "Café Chip", x: 0, y: 0, reusable: true },
        ],
      },
    ],
  };

  test("components are grouped by page; a library page shows the library's name", () => {
    const sections = componentSections(withLibrary, listComponents(withLibrary), "");
    const summary = sections.map((s) => [s.title, s.library, s.entries.map((e) => e.name)]);
    expect(summary[0]).toEqual(["Home", false, ["Card"]]);
    expect(summary.at(-1)).toEqual(["Kit", true, ["Café Chip"]]);
    expect(sections.flatMap((s) => s.entries).length).toBe(listComponents(withLibrary).length);
  });

  test("search matches every word, ignoring case and accents; empty pages are dropped", () => {
    const sections = componentSections(withLibrary, listComponents(withLibrary), "cafe CHIP");
    expect(sections.map((s) => s.entries.map((e) => e.id))).toEqual([["chip"]]);
    expect(componentSections(withLibrary, listComponents(withLibrary), "nothing")).toEqual([]);
  });

  test("a dropped instance is centered on the point, inside the frame under it", () => {
    const op = dropInstanceOp(
      { id: "card", name: "Card" },
      { width: 100, height: 40 },
      { x: 300, y: 200 },
      "p1",
      {
        id: "f",
        x: 200,
        y: 100,
      },
    );
    expect(op).toMatchObject({ parentId: "f", node: { ref: "card", x: 50, y: 80 } });
    const top = dropInstanceOp(
      { id: "card", name: "Card" },
      { width: 100, height: 40 },
      { x: 300, y: 200 },
      "p1",
      null,
    );
    expect(top).toMatchObject({ parentId: "p1", node: { x: 250, y: 180 } });
    expect(findNode(applyOp(doc, top), top.node.id)?.type).toBe("ref");
  });
});
