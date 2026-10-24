import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import { buildConfirmOps } from "./confirm-edit";
import { defaultTextColor, DARK_TEXT, LIGHT_TEXT } from "./default-text-color";
import { deriveEditorStyle } from "./editor-style";

const doc: PegoDocument = {
  version: 8,
  variables: { fg: { type: "color", value: "#FF0000" }, size: { type: "number", value: 20 } },
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          id: "f",
          type: "frame",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
          layout: "none",
          children: [{ id: "t", type: "text", x: 0, y: 0, content: "hello" }],
        },
      ],
    },
  ],
} as unknown as PegoDocument;

describe("buildConfirmOps", () => {
  test("edit unchanged commits nothing", () => {
    expect(buildConfirmOps(doc, { mode: "edit", id: "t" }, "hello")).toBeNull();
  });
  test("edit changed is one update", () => {
    const r = buildConfirmOps(doc, { mode: "edit", id: "t" }, "bye");
    expect(r?.label).toBe("Edit text");
    expect(r?.ops).toEqual([{ op: "update", id: "t", props: { content: "bye" } }]);
  });
  test("edit emptied deletes", () => {
    const r = buildConfirmOps(doc, { mode: "edit", id: "t" }, "  ");
    expect(r?.ops).toEqual([{ op: "delete", id: "t" }]);
  });
  test("edit missing node is null", () => {
    expect(buildConfirmOps(doc, { mode: "edit", id: "nope" }, "x")).toBeNull();
  });
  test("create empty inserts nothing", () => {
    expect(buildConfirmOps(doc, { mode: "create", parentId: "f", x: 1, y: 2 }, "")).toBeNull();
  });
  test("create inserts dark text on light frame and selects it", () => {
    const r = buildConfirmOps(doc, { mode: "create", parentId: "f", x: 5, y: 6 }, "hi", () => "n1");
    expect(r?.selectId).toBe("n1");
    expect(r?.ops[0]).toMatchObject({
      op: "insert",
      parentId: "f",
      node: { id: "n1", type: "text", name: "Text", x: 5, y: 6, fontSize: 16, fill: DARK_TEXT },
    });
  });
  test("create at root uses light text", () => {
    const r = buildConfirmOps(doc, { mode: "create", parentId: null, x: 0, y: 0 }, "hi");
    expect(r?.ops[0]).toMatchObject({ node: { fill: LIGHT_TEXT } });
  });
});

describe("defaultTextColor", () => {
  test("light and dark fills", () => {
    expect(defaultTextColor("#fff")).toBe(DARK_TEXT);
    expect(defaultTextColor("#1B1B21")).toBe(LIGHT_TEXT);
    expect(defaultTextColor(undefined)).toBe(LIGHT_TEXT);
  });
});

describe("deriveEditorStyle", () => {
  const camera = { panX: 10, panY: 20, zoom: 2 };
  test("places, rotates and scales", () => {
    const s = deriveEditorStyle(
      { fontSize: "$size", fill: "$fg", fontWeight: 590 },
      [
        { x: 100, y: 50, rotation: 10 },
        { x: 5, y: 6, rotation: 0 },
      ],
      50,
      camera,
      doc.variables,
      "#000000",
    );
    expect(s).toMatchObject({ fontSize: 20, color: "#FF0000", fontWeight: 600, wraps: false });
    expect(s.transform).toBe(
      "translate(10px, 20px) scale(2) translate(100px, 50px) rotate(-10deg) translate(5px, 6px)",
    );
    expect(s.width).toBeUndefined();
    expect(s.outlineWidth).toBe(0.5);
  });
  test("wraps at box width for numeric and fill widths", () => {
    for (const width of [80, "fill_container" as const]) {
      const s = deriveEditorStyle({ width }, [], 80, camera, {}, "#000");
      expect(s.wraps).toBe(true);
      expect(s.width).toBe(80);
      expect(s.fontSize).toBe(14);
    }
  });
});
