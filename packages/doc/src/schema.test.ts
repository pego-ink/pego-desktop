import { describe, expect, test } from "bun:test";
import { documentSchema, nodeSchema } from "./schema";
import { opSchema, type Op } from "./ops";
import { sampleDoc } from "./sample-doc";

describe("documentSchema", () => {
  test("parses the sample doc", () => {
    expect(documentSchema.safeParse(sampleDoc).success).toBe(true);
  });

  test("rejects an invalid node", () => {
    expect(nodeSchema.safeParse({ type: "blob", id: "x" }).success).toBe(false);
    expect(nodeSchema.safeParse({ type: "rectangle", id: "" }).success).toBe(false);
    expect(nodeSchema.safeParse({ type: "rectangle", id: "r", fill: "red" }).success).toBe(false);
  });

  test("rejects invalid nodes nested in children", () => {
    const bad = {
      ...sampleDoc,
      children: [{ type: "frame", id: "f", children: [{ type: "nope" }] }],
    };
    expect(documentSchema.safeParse(bad).success).toBe(false);
  });
});

describe("opSchema", () => {
  const node = { type: "ellipse", id: "e1" } as const;
  const ops: Op[] = [
    { op: "insert", parentId: "frame-1", index: 0, node: nodeSchema.parse(node) },
    { op: "update", id: "rect-1", props: { fill: "#fff" } },
    { op: "replace", id: "rect-1", node: nodeSchema.parse(node) },
    { op: "move", id: "rect-1", parentId: null, index: 1 },
    { op: "delete", id: "rect-1" },
    { op: "setVariables", variables: { accent: { type: "color", value: "#0E7C5A" } } },
  ];

  test("parses one of each op kind", () => {
    const kinds = ops.map((op) => {
      const parsed = opSchema.parse(op);
      return parsed.op;
    });
    expect(kinds).toEqual(["insert", "update", "replace", "move", "delete", "setVariables"]);
  });

  test("rejects unknown op", () => {
    expect(opSchema.safeParse({ op: "explode" }).success).toBe(false);
  });
});

describe("v1 props", () => {
  test("parses effects, per-side stroke, text spacing and path viewBox", () => {
    const frame = nodeSchema.parse({
      type: "frame",
      id: "f",
      stroke: { color: "#000", width: [0, 0, 1, 0] },
      effects: [
        { type: "shadow", color: "#00000033", y: 4, blur: 8 },
        { type: "blur", radius: 2 },
      ],
      children: [
        { type: "text", id: "t", content: "x", lineHeight: 1.4, letterSpacing: "$tight" },
        { type: "path", id: "p", geometry: "M0 0L1 1", viewBox: [0, 0, 24, 24] },
      ],
    });
    expect(frame).toMatchObject({
      effects: [
        { type: "shadow", x: 0, y: 4, blur: 8 },
        { type: "blur", radius: 2 },
      ],
    });
  });

  test("rejects malformed effects and strokes", () => {
    const bad = [
      { type: "rectangle", id: "r", effects: [{ type: "glow" }] },
      { type: "rectangle", id: "r", effects: [{ type: "shadow" }] },
      { type: "rectangle", id: "r", stroke: { color: "#000", width: [1, 2] } },
      { type: "path", id: "p", geometry: "M0 0", viewBox: [0, 0, 24] },
    ];
    for (const node of bad) expect(nodeSchema.safeParse(node).success).toBe(false);
  });
});

describe("image source", () => {
  const image = (url: string) => ({
    type: "image",
    id: "i",
    src: "https://a.b/c.png",
    source: { url },
  });

  test("accepts http(s) URLs", () => {
    expect(nodeSchema.safeParse(image("https://example.com/p")).success).toBe(true);
    expect(nodeSchema.safeParse(image("http://localhost:3000")).success).toBe(true);
  });

  test("rejects javascript: and custom-scheme URLs", () => {
    for (const url of ["javascript:alert(1)", "vscode://file/etc/passwd", "file:///etc/passwd"]) {
      expect(nodeSchema.safeParse(image(url)).success).toBe(false);
    }
  });
});
