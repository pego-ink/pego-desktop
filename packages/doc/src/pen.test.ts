import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveInstance } from "./instance";
import { computeLayout } from "./layout";
import { importPen, PenImportError } from "./pen";
import type { PegoNode } from "./schema";
import { findNode } from "./tree";

const pen = (children: unknown[], extra: Record<string, unknown> = {}) =>
  importPen({ version: "2.21", children, ...extra });

const only = (children: unknown[]) => pen(children).doc.children[0];

describe("importPen", () => {
  test("rejects input that is not a .pen document", () => {
    expect(() => importPen({ nodes: [] })).toThrow(PenImportError);
    expect(() => importPen("x")).toThrow(PenImportError);
  });

  test("frames without layout become horizontal rows", () => {
    expect(only([{ type: "frame", id: "f", gap: 8 }])).toMatchObject({ layout: "horizontal" });
    expect(only([{ type: "frame", id: "f", layout: "none" }])).toMatchObject({ layout: "none" });
  });

  test("expands two- and three-value padding to four sides", () => {
    expect(only([{ type: "frame", id: "f", padding: [4, 8] }])).toMatchObject({
      padding: [4, 8, 4, 8],
    });
    expect(only([{ type: "frame", id: "f", padding: [1, 2, 3] }])).toMatchObject({
      padding: [1, 2, 3, 2],
    });
  });

  test("converts stroke, per-side stroke width and shadow effects", () => {
    const node = only([
      {
        type: "frame",
        id: "f",
        stroke: "$line",
        strokeWidth: { bottom: 1 },
        effect: {
          type: "shadow",
          shadowType: "inner",
          color: "#00000055",
          offset: { x: 1, y: 2 },
          blur: 3,
          spread: 4,
        },
      },
    ]);
    expect(node).toMatchObject({
      stroke: { color: "$line", width: [0, 0, 1, 0] },
      effects: [
        { type: "shadow", inner: true, color: "#00000055", x: 1, y: 2, blur: 3, spread: 4 },
      ],
    });
  });

  test("maps text growth, font weights and icon props", () => {
    const { doc } = pen([
      {
        type: "frame",
        id: "f",
        children: [
          { type: "text", id: "a", content: "Auto", width: 100, fontWeight: "normal" },
          {
            type: "text",
            id: "b",
            content: "Wrap",
            textGrowth: "fixed-width",
            width: "fill_container",
            height: 40,
            fontWeight: "600",
            lineHeight: 1.5,
          },
          { type: "icon", id: "i", icon: "check", library: "lucide", width: 14, height: 14 },
        ],
      },
    ]);
    const a = findNode(doc, "a");
    expect(a).toMatchObject({ fontWeight: 400 });
    expect(a).not.toHaveProperty("width");
    const b = findNode(doc, "b");
    expect(b).toMatchObject({ width: "fill_container", fontWeight: 600, lineHeight: 1.5 });
    expect(b).not.toHaveProperty("height");
    expect(findNode(doc, "i")).toMatchObject({ iconName: "check", iconSet: "lucide" });
  });

  test("converts descendant overrides with node prop names", () => {
    const { doc } = pen([
      {
        type: "frame",
        id: "btn",
        reusable: true,
        children: [{ type: "icon", id: "ic", icon: "plus", library: "lucide" }],
      },
      { type: "ref", id: "r", ref: "btn", descendants: { ic: { icon: "minus", fill: "#fff" } } },
    ]);
    expect(findNode(doc, "r")).toMatchObject({
      descendants: { ic: { iconName: "minus", fill: "#fff" } },
    });
  });

  test("detaches instances that replace a descendant", () => {
    const { doc, warnings } = pen([
      {
        type: "frame",
        id: "input",
        reusable: true,
        children: [{ type: "text", id: "prefix", content: "X" }],
      },
      {
        type: "ref",
        id: "r",
        ref: "input",
        x: 50,
        descendants: { prefix: { type: "icon", id: "ic", icon: "move", library: "lucide" } },
      },
    ]);
    const detached = findNode(doc, "r");
    expect(detached).toMatchObject({ type: "frame", x: 50 });
    expect(detached).not.toHaveProperty("reusable");
    expect(findNode(doc, "r-ic")).toMatchObject({ type: "icon", iconName: "move" });
    expect(warnings[0]?.message).toMatch(/detached/);
  });

  test("keeps variables, drops unsupported types and reports unknown props", () => {
    const { doc, warnings } = pen(
      [
        { type: "rectangle", id: "r", width: 10, height: 10, sparkle: true },
        { type: "hologram", id: "h" },
      ],
      {
        variables: {
          accent: { type: "color", value: "#FF0000" },
          ui: { type: "string", value: "Geist" },
          dark: { type: "boolean", value: true },
        },
      },
    );
    expect(Object.keys(doc.variables)).toEqual(["accent", "ui"]);
    expect(doc.children.map((n) => n.id)).toEqual(["r"]);
    expect(warnings.map((w) => w.message)).toEqual([
      'Variable of type "boolean" is not supported and was dropped',
      'Property "sparkle" on rectangle is not supported and was dropped',
      'Node type "hologram" is not supported and was skipped',
    ]);
  });

  test("imports design/pego.pen with every instance resolving", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../../design/pego.pen", import.meta.url), "utf8"),
    ) as unknown;
    const { doc } = importPen(raw, "pego");
    const all: PegoNode[] = [];
    const walk = (node: PegoNode) => {
      all.push(node);
      if ("children" in node) node.children.forEach(walk);
    };
    doc.children.forEach(walk);
    expect(all.length).toBeGreaterThan(800);
    const refs = all.filter((node) => node.type === "ref");
    expect(refs.length).toBeGreaterThan(30);
    for (const ref of refs) expect(resolveInstance(doc, ref)).not.toBeNull();
    const layout = computeLayout(doc, (node) => ({ width: node.content.length * 7, height: 16 }));
    expect(layout.get("vt8je")).toMatchObject({ width: 1440, height: 900 });
  });
});
