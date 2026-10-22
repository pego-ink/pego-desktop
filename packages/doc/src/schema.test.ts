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
