import { describe, expect, test } from "bun:test";
import { applyOp, applyOps, invertOp, OpError, type Op, type OpErrorCode } from "./ops";
import { documentSchema, nodeSchema, type PegoDocument, type PegoNode } from "./schema";
import { findNode } from "./tree";

const node = (input: Record<string, unknown>): PegoNode => nodeSchema.parse(input);

const makeDoc = (): PegoDocument =>
  documentSchema.parse({
    version: 9,
    id: "doc",
    name: "Test",
    variables: { accent: { type: "color", value: "#0E7C5A" } },
    children: [
      {
        type: "page",
        id: "page-1",
        name: "Page 1",
        x: 0,
        y: 0,
        children: [
          {
            type: "frame",
            id: "f1",
            children: [
              { type: "rectangle", id: "r1", x: 10, y: 20, fill: "#112233" },
              { type: "ellipse", id: "e1" },
              {
                type: "group",
                id: "g1",
                children: [
                  { type: "text", id: "t1", content: "hi" },
                  { type: "rectangle", id: "r2" },
                ],
              },
            ],
          },
          { type: "frame", id: "f2", children: [] },
          { type: "rectangle", id: "r3" },
        ],
      },
    ],
  });

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
};

const ids = (doc: PegoDocument, parentId: string | null): string[] => {
  const parent = parentId === null ? doc : findNode(doc, parentId);
  if (!parent || !("children" in parent)) throw new Error(`no container ${parentId}`);
  return parent.children.map((c) => c.id);
};

const expectOpError = (fn: () => unknown, code: OpErrorCode) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OpError);
    expect((error as OpError).code).toBe(code);
    return;
  }
  throw new Error(`expected OpError ${code}, nothing thrown`);
};

const roundTrip = (doc: PegoDocument, op: Op) => {
  const before = structuredClone(doc);
  const after = applyOp(doc, op);
  const restored = applyOp(after, invertOp(doc, op));
  expect(restored).toStrictEqual(before);
  return after;
};

describe("applyOp: insert", () => {
  test("appends when index is omitted", () => {
    const next = applyOp(makeDoc(), {
      op: "insert",
      parentId: "f1",
      node: node({ type: "ellipse", id: "n" }),
    });
    expect(ids(next, "f1")).toEqual(["r1", "e1", "g1", "n"]);
  });

  test("inserts at the top of a page", () => {
    const next = applyOp(makeDoc(), {
      op: "insert",
      parentId: "page-1",
      index: 0,
      node: node({ type: "ellipse", id: "n" }),
    });
    expect(ids(next, "page-1")).toEqual(["n", "f1", "f2", "r3"]);
  });

  test("inserts at a specific index", () => {
    const next = applyOp(makeDoc(), {
      op: "insert",
      parentId: "f1",
      index: 1,
      node: node({ type: "ellipse", id: "n" }),
    });
    expect(ids(next, "f1")).toEqual(["r1", "n", "e1", "g1"]);
  });

  test("clamps an index past the end to append", () => {
    const next = applyOp(makeDoc(), {
      op: "insert",
      parentId: "f1",
      index: 999,
      node: node({ type: "ellipse", id: "n" }),
    });
    expect(ids(next, "f1")).toEqual(["r1", "e1", "g1", "n"]);
  });

  test("inserts a subtree", () => {
    const sub = node({
      type: "frame",
      id: "nf",
      children: [{ type: "rectangle", id: "nr" }],
    });
    const next = applyOp(makeDoc(), { op: "insert", parentId: "f2", node: sub });
    expect(ids(next, "nf")).toEqual(["nr"]);
  });

  test("fails with parent_not_found", () => {
    expectOpError(
      () =>
        applyOp(makeDoc(), {
          op: "insert",
          parentId: "nope",
          node: node({ type: "ellipse", id: "n" }),
        }),
      "parent_not_found",
    );
  });

  test("fails with parent_not_container when parent is a rectangle", () => {
    expectOpError(
      () =>
        applyOp(makeDoc(), {
          op: "insert",
          parentId: "r1",
          node: node({ type: "ellipse", id: "n" }),
        }),
      "parent_not_container",
    );
  });

  test("fails with duplicate_id for an existing id", () => {
    expectOpError(
      () =>
        applyOp(makeDoc(), {
          op: "insert",
          parentId: "f2",
          node: node({ type: "ellipse", id: "r1" }),
        }),
      "duplicate_id",
    );
  });

  test("fails with duplicate_id when the subtree repeats an id internally", () => {
    const sub = node({
      type: "frame",
      id: "nf",
      children: [
        { type: "rectangle", id: "dup" },
        { type: "ellipse", id: "dup" },
      ],
    });
    expectOpError(
      () => applyOp(makeDoc(), { op: "insert", parentId: "f2", node: sub }),
      "duplicate_id",
    );
  });

  test("fails with duplicate_id when a descendant id collides with the document", () => {
    const sub = node({ type: "group", id: "ng", children: [{ type: "rectangle", id: "t1" }] });
    expectOpError(
      () => applyOp(makeDoc(), { op: "insert", parentId: "f2", node: sub }),
      "duplicate_id",
    );
  });

  test("round-trips", () => {
    roundTrip(makeDoc(), {
      op: "insert",
      parentId: "f1",
      index: 1,
      node: node({ type: "ellipse", id: "n" }),
    });
  });
});

describe("applyOp: update", () => {
  test("shallow merges props and keeps others", () => {
    const next = applyOp(makeDoc(), { op: "update", id: "r1", props: { x: 99, name: "Card" } });
    expect(findNode(next, "r1")).toMatchObject({ x: 99, y: 20, name: "Card", fill: "#112233" });
  });

  test("null removes a prop", () => {
    const next = applyOp(makeDoc(), { op: "update", id: "r1", props: { fill: null } });
    expect(findNode(next, "r1")).not.toHaveProperty("fill");
  });

  test("updates a container without touching its children", () => {
    const doc = makeDoc();
    const next = applyOp(doc, {
      op: "update",
      id: "f1",
      props: { fill: "#000000", layout: "vertical" },
    });
    expect(findNode(next, "f1")).toMatchObject({ fill: "#000000", layout: "vertical" });
    expect(ids(next, "f1")).toEqual(["r1", "e1", "g1"]);
    expect(ids(next, "g1")).toEqual(["t1", "r2"]);
  });

  test.each(["id", "type", "children"])("rejects forbidden key %s", (key) => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "update", id: "f1", props: { [key]: "x" } }),
      "invalid_props",
    );
  });

  test("rejects props that fail the node schema", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "update", id: "r1", props: { fill: "red" } }),
      "invalid_props",
    );
  });

  test("rejects removing a required prop", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "update", id: "t1", props: { content: null } }),
      "invalid_props",
    );
  });

  test("fails with node_not_found", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "update", id: "nope", props: { x: 1 } }),
      "node_not_found",
    );
  });

  test("round-trips adding an absent prop", () => {
    const after = roundTrip(makeDoc(), { op: "update", id: "r1", props: { opacity: 0.5 } });
    expect(findNode(after, "r1")).toHaveProperty("opacity", 0.5);
  });

  test("round-trips removing a prop", () => {
    roundTrip(makeDoc(), { op: "update", id: "r1", props: { fill: null } });
  });

  test("round-trips changing, adding and removing in one op", () => {
    roundTrip(makeDoc(), { op: "update", id: "r1", props: { x: 1, opacity: 0.2, fill: null } });
  });

  test("round-trips updating a container", () => {
    roundTrip(makeDoc(), { op: "update", id: "g1", props: { name: "G", rotation: 10 } });
  });
});

describe("applyOp: replace", () => {
  test("swaps the node in place", () => {
    const next = applyOp(makeDoc(), {
      op: "replace",
      id: "e1",
      node: node({ type: "rectangle", id: "e1" }),
    });
    expect(ids(next, "f1")).toEqual(["r1", "e1", "g1"]);
    expect(findNode(next, "e1")?.type).toBe("rectangle");
  });

  test("allows a different id", () => {
    const next = applyOp(makeDoc(), {
      op: "replace",
      id: "e1",
      node: node({ type: "ellipse", id: "e9" }),
    });
    expect(ids(next, "f1")).toEqual(["r1", "e9", "g1"]);
    expect(findNode(next, "e1")).toBeNull();
  });

  test("allows reusing ids from the replaced subtree", () => {
    const sub = node({ type: "frame", id: "g1", children: [{ type: "rectangle", id: "t1" }] });
    const next = applyOp(makeDoc(), { op: "replace", id: "g1", node: sub });
    expect(ids(next, "g1")).toEqual(["t1"]);
    expect(findNode(next, "t1")?.type).toBe("rectangle");
  });

  test("fails with duplicate_id when the new node collides outside the replaced subtree", () => {
    expectOpError(
      () =>
        applyOp(makeDoc(), { op: "replace", id: "e1", node: node({ type: "ellipse", id: "r1" }) }),
      "duplicate_id",
    );
  });

  test("fails with duplicate_id for repeated ids inside the new node", () => {
    const sub = node({
      type: "group",
      id: "ng",
      children: [
        { type: "rectangle", id: "d" },
        { type: "rectangle", id: "d" },
      ],
    });
    expectOpError(() => applyOp(makeDoc(), { op: "replace", id: "e1", node: sub }), "duplicate_id");
  });

  test("fails with node_not_found", () => {
    expectOpError(
      () =>
        applyOp(makeDoc(), { op: "replace", id: "nope", node: node({ type: "ellipse", id: "n" }) }),
      "node_not_found",
    );
  });

  test("round-trips with a different id", () => {
    roundTrip(makeDoc(), { op: "replace", id: "e1", node: node({ type: "ellipse", id: "e9" }) });
  });

  test("round-trips replacing a container with children", () => {
    const sub = node({ type: "frame", id: "g1", children: [{ type: "rectangle", id: "t1" }] });
    roundTrip(makeDoc(), { op: "replace", id: "g1", node: sub });
  });
});

describe("applyOp: move", () => {
  test("moves across parents", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "f2" });
    expect(ids(next, "f1")).toEqual(["e1", "g1"]);
    expect(ids(next, "f2")).toEqual(["r1"]);
  });

  test("moves to the top of a page at an index", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "page-1", index: 1 });
    expect(ids(next, "page-1")).toEqual(["f1", "r1", "f2", "r3"]);
  });

  test("index is the final position within the same parent, moving forward", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "f1", index: 2 });
    expect(ids(next, "f1")).toEqual(["e1", "g1", "r1"]);
    const mid = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "f1", index: 1 });
    expect(ids(mid, "f1")).toEqual(["e1", "r1", "g1"]);
  });

  test("index is the final position within the same parent, moving backward", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "g1", parentId: "f1", index: 0 });
    expect(ids(next, "f1")).toEqual(["g1", "r1", "e1"]);
  });

  test("clamps an index past the end", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "f1", index: 50 });
    expect(ids(next, "f1")).toEqual(["e1", "g1", "r1"]);
  });

  test("appends when index is omitted", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "r1", parentId: "f1" });
    expect(ids(next, "f1")).toEqual(["e1", "g1", "r1"]);
  });

  test("moving a container keeps its subtree", () => {
    const next = applyOp(makeDoc(), { op: "move", id: "g1", parentId: "f2" });
    expect(ids(next, "g1")).toEqual(["t1", "r2"]);
  });

  test("fails with cycle when moving into itself", () => {
    expectOpError(() => applyOp(makeDoc(), { op: "move", id: "f1", parentId: "f1" }), "cycle");
  });

  test("fails with cycle when moving into a descendant", () => {
    expectOpError(() => applyOp(makeDoc(), { op: "move", id: "f1", parentId: "g1" }), "cycle");
  });

  test("fails with node_not_found", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "move", id: "nope", parentId: null }),
      "node_not_found",
    );
  });

  test("fails with parent_not_found", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "move", id: "r1", parentId: "nope" }),
      "parent_not_found",
    );
  });

  test("fails with parent_not_container", () => {
    expectOpError(
      () => applyOp(makeDoc(), { op: "move", id: "r1", parentId: "r3" }),
      "parent_not_container",
    );
  });

  test("round-trips within the same parent forward", () => {
    roundTrip(makeDoc(), { op: "move", id: "r1", parentId: "f1", index: 2 });
  });

  test("round-trips within the same parent backward", () => {
    roundTrip(makeDoc(), { op: "move", id: "g1", parentId: "f1", index: 0 });
  });

  test("round-trips with an omitted index", () => {
    roundTrip(makeDoc(), { op: "move", id: "r1", parentId: "f1" });
  });

  test("round-trips across parents", () => {
    roundTrip(makeDoc(), { op: "move", id: "r1", parentId: "f2" });
    roundTrip(makeDoc(), { op: "move", id: "t1", parentId: "page-1", index: 1 });
    roundTrip(makeDoc(), { op: "move", id: "r3", parentId: "g1", index: 1 });
  });
});

describe("applyOp: delete", () => {
  test("removes a leaf", () => {
    const next = applyOp(makeDoc(), { op: "delete", id: "e1" });
    expect(ids(next, "f1")).toEqual(["r1", "g1"]);
  });

  test("removes a container with its subtree", () => {
    const next = applyOp(makeDoc(), { op: "delete", id: "g1" });
    expect(findNode(next, "g1")).toBeNull();
    expect(findNode(next, "t1")).toBeNull();
  });

  test("fails with node_not_found", () => {
    expectOpError(() => applyOp(makeDoc(), { op: "delete", id: "nope" }), "node_not_found");
  });

  test("round-trips a nested container with children", () => {
    roundTrip(makeDoc(), { op: "delete", id: "g1" });
    roundTrip(makeDoc(), { op: "delete", id: "f1" });
    roundTrip(makeDoc(), { op: "delete", id: "r3" });
  });
});

describe("applyOp: setVariables", () => {
  test("adds and overwrites variables", () => {
    const next = applyOp(makeDoc(), {
      op: "setVariables",
      variables: { gap: { type: "number", value: 8 }, accent: { type: "color", value: "#FFFFFF" } },
    });
    expect(next.variables).toEqual({
      accent: { type: "color", value: "#FFFFFF" },
      gap: { type: "number", value: 8 },
    });
  });

  test("null removes a variable", () => {
    const next = applyOp(makeDoc(), { op: "setVariables", variables: { accent: null } });
    expect(next.variables).toEqual({});
  });

  test("removing an unknown variable is a no-op", () => {
    const next = applyOp(makeDoc(), { op: "setVariables", variables: { ghost: null } });
    expect(next.variables).toEqual(makeDoc().variables);
  });

  test("round-trips adding", () => {
    roundTrip(makeDoc(), { op: "setVariables", variables: { gap: { type: "number", value: 8 } } });
  });

  test("round-trips removing", () => {
    roundTrip(makeDoc(), { op: "setVariables", variables: { accent: null } });
  });

  test("round-trips mixed add, change and remove", () => {
    roundTrip(makeDoc(), {
      op: "setVariables",
      variables: {
        accent: { type: "color", value: "#000000" },
        gap: { type: "number", value: 1 },
        nope: null,
      },
    });
  });
});

describe("immutability", () => {
  const ops: Op[] = [
    { op: "insert", parentId: "f1", index: 0, node: node({ type: "ellipse", id: "n" }) },
    { op: "update", id: "r1", props: { x: 5, fill: null } },
    { op: "update", id: "f1", props: { name: "F" } },
    { op: "replace", id: "g1", node: node({ type: "group", id: "g9", children: [] }) },
    { op: "move", id: "r1", parentId: "f2", index: 0 },
    { op: "move", id: "r1", parentId: "f1", index: 2 },
    { op: "delete", id: "g1" },
    { op: "setVariables", variables: { accent: null, n: { type: "number", value: 1 } } },
  ];

  test.each(ops.map((op) => [op.op, op] as const))(
    "applyOp %s does not mutate the input",
    (_name, op) => {
      const doc = deepFreeze(makeDoc());
      const snapshot = structuredClone(doc);
      const next = applyOp(doc, op);
      expect(doc).toStrictEqual(snapshot);
      expect(next).not.toBe(doc);
    },
  );

  test("invertOp does not mutate the input", () => {
    const doc = deepFreeze(makeDoc());
    const snapshot = structuredClone(doc);
    for (const op of ops) invertOp(doc, op);
    expect(doc).toStrictEqual(snapshot);
  });

  test("applyOps does not mutate the input", () => {
    const doc = deepFreeze(makeDoc());
    const snapshot = structuredClone(doc);
    applyOps(doc, ops.slice(0, 3));
    expect(doc).toStrictEqual(snapshot);
  });
});

describe("applyOps", () => {
  test("applies ops in order", () => {
    const { doc } = applyOps(makeDoc(), [
      { op: "insert", parentId: "f2", node: node({ type: "frame", id: "nf", children: [] }) },
      { op: "move", id: "r1", parentId: "nf" },
      { op: "update", id: "r1", props: { x: 7 } },
    ]);
    expect(ids(doc, "nf")).toEqual(["r1"]);
    expect(findNode(doc, "r1")).toMatchObject({ x: 7 });
  });

  test("is all-or-nothing and propagates the error", () => {
    const doc = deepFreeze(makeDoc());
    const snapshot = structuredClone(doc);
    const run = () =>
      applyOps(doc, [
        { op: "update", id: "r1", props: { x: 1 } },
        { op: "delete", id: "e1" },
        { op: "move", id: "nope", parentId: null },
        { op: "delete", id: "r3" },
      ]);
    expectOpError(run, "node_not_found");
    expect(doc).toStrictEqual(snapshot);
  });

  test("inverse restores the original doc", () => {
    const doc = makeDoc();
    const { doc: after, inverse } = applyOps(doc, [
      { op: "update", id: "r1", props: { x: 1, opacity: 0.3 } },
      { op: "move", id: "g1", parentId: "f2" },
      { op: "move", id: "r1", parentId: "g1", index: 0 },
      { op: "delete", id: "e1" },
      { op: "replace", id: "r3", node: node({ type: "ellipse", id: "r9" }) },
      { op: "setVariables", variables: { accent: null, z: { type: "string", value: "s" } } },
    ]);
    expect(after).not.toStrictEqual(doc);
    expect(applyOps(after, inverse).doc).toStrictEqual(doc);
  });

  test("inverse handles several ops touching the same node", () => {
    const doc = makeDoc();
    const { doc: after, inverse } = applyOps(doc, [
      { op: "update", id: "r1", props: { x: 1 } },
      { op: "update", id: "r1", props: { x: 2, fill: null } },
      { op: "move", id: "r1", parentId: "f1", index: 2 },
      { op: "move", id: "r1", parentId: "f1", index: 0 },
    ]);
    expect(applyOps(after, inverse).doc).toStrictEqual(doc);
  });

  test("empty op list returns an equal doc and empty inverse", () => {
    const doc = makeDoc();
    const result = applyOps(doc, []);
    expect(result.doc).toStrictEqual(doc);
    expect(result.inverse).toEqual([]);
  });
});

describe("pages", () => {
  const page = (id: string) => node({ type: "page", id, name: id, children: [] });

  test("pages go only at the root, and only pages go there", () => {
    const withPage = applyOp(makeDoc(), { op: "insert", parentId: null, node: page("p2") });
    expect(withPage.children.map((p) => p.id)).toEqual(["page-1", "p2"]);
    const codes = [
      () =>
        applyOp(makeDoc(), {
          op: "insert",
          parentId: null,
          node: node({ type: "ellipse", id: "e" }),
        }),
      () => applyOp(makeDoc(), { op: "insert", parentId: "f1", node: page("p3") }),
      () => applyOp(makeDoc(), { op: "move", id: "r1", parentId: null }),
      () => applyOp(withPage, { op: "move", id: "p2", parentId: "f1" }),
      () => applyOp(makeDoc(), { op: "replace", id: "f1", node: page("p4") }),
    ].map((run) => {
      try {
        run();
        return "ok";
      } catch (error) {
        return (error as OpError).code;
      }
    });
    expect(codes).toEqual(Array(5).fill("invalid_parent"));
  });

  test("nodes move between pages and undo restores them", () => {
    const doc = applyOp(makeDoc(), { op: "insert", parentId: null, node: page("p2") });
    roundTrip(doc, { op: "move", id: "f2", parentId: "p2" });
    const moved = applyOp(doc, { op: "move", id: "f2", parentId: "p2" });
    expect(ids(moved, "p2")).toEqual(["f2"]);
  });

  test("the last page cannot be deleted, others can", () => {
    expect(() => applyOp(makeDoc(), { op: "delete", id: "page-1" })).toThrow(
      expect.objectContaining({ code: "last_page" }),
    );
    const doc = applyOp(makeDoc(), { op: "insert", parentId: null, node: page("p2") });
    roundTrip(doc, { op: "delete", id: "page-1" });
  });

  test("pages are renamed with update", () => {
    const next = applyOp(makeDoc(), { op: "update", id: "page-1", props: { name: "Main flow" } });
    expect(next.children[0]?.name).toBe("Main flow");
  });
});
