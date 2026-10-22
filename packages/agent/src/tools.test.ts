import { describe, expect, test } from "bun:test";
import { findNode, type PegoDocument } from "@pego/doc";
import { agentTools, coreTools, toolByName } from "./tools";
import { editTools } from "./tools-edit";
import { inspectTools } from "./tools-inspect";
import { createFakeHost } from "./test-host";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const call = async (name: string, input: unknown, host = createFakeHost()) => {
  const tool = toolByName(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.run(input, host);
  return { host, isError: result.isError, data: JSON.parse(result.content) as Json };
};

describe("tool registry", () => {
  test("names are unique snake_case and every inputSchema is an object schema", () => {
    const names = agentTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...coreTools, ...editTools, ...inspectTools].map((t) => t.name));
    expect(coreTools.map((t) => t.name)).toEqual([
      "get_document",
      "get_node",
      "insert_nodes",
      "update_node",
      "replace_node",
      "move_node",
      "delete_nodes",
      "set_variables",
      "apply_ops",
      "report_plan",
      "report_step",
      "ask_user",
    ]);
    for (const tool of agentTools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(() => JSON.stringify(tool.inputSchema)).not.toThrow();
    }
  });
});

describe("get_document / get_node", () => {
  test("get_document returns serialized text", async () => {
    const { data, isError } = await call("get_document", {});
    expect(isError).toBe(false);
    expect(data.document).toContain("rectangle#rect-1");
  });

  test("get_document supports rootId and maxDepth", async () => {
    const { data } = await call("get_document", { rootId: "frame-1", maxDepth: 0 });
    expect(data.document).toContain("(2 children not shown)");
    expect(data.document).not.toContain("rect-1");
  });

  test("get_document unknown rootId errors with hint", async () => {
    const { data, isError } = await call("get_document", { rootId: "nope" });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("node_not_found");
    expect(data.error.hint).toContain("get_document");
  });

  test("get_document rejects unknown fields", async () => {
    const { data, isError } = await call("get_document", { depth: 2 });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("invalid_input");
  });

  test("get_node returns props, parent and index", async () => {
    const { data } = await call("get_node", { id: "text-1" });
    expect(data.parentId).toBe("frame-1");
    expect(data.index).toBe(1);
    expect(data.props.content).toBe("Hello, Pego");
    const frame = (await call("get_node", { id: "frame-1" })).data;
    expect(frame.children.map((c: Json) => c.id)).toEqual(["rect-1", "text-1"]);
    expect(frame.props.children).toBeUndefined();
  });

  test("get_node missing id errors", async () => {
    const { data, isError } = await call("get_node", { id: "ghost" });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("node_not_found");
  });
});

describe("insert_nodes", () => {
  test("assigns ids in nested subtrees and returns the id tree", async () => {
    const { host, data, isError } = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [
        {
          type: "frame",
          name: "Row",
          layout: "horizontal",
          gap: 8,
          children: [
            { type: "text", name: "Label", content: "Hi" },
            { type: "frame", name: "Inner", children: [{ type: "ellipse", name: "Dot" }] },
          ],
        },
      ],
    });
    expect(isError).toBe(false);
    const row = data.created[0];
    expect(row.name).toBe("Row");
    expect(row.children.map((c: Json) => c.name)).toEqual(["Label", "Inner"]);
    expect(row.children[1].children[0].name).toBe("Dot");
    const ids = [row.id, row.children[0].id, row.children[1].id, row.children[1].children[0].id];
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(findNode(host.doc(), id)).not.toBeNull();
    expect(host.calls.focus.at(-1)).toEqual([row.id]);
  });

  test("keeps supplied ids and respects index", async () => {
    const { host } = await call("insert_nodes", {
      parentId: "frame-1",
      index: 0,
      nodes: [{ type: "rectangle", id: "mine" }, { type: "ellipse" }],
    });
    const frame = findNode(host.doc(), "frame-1") as { children: { id: string }[] };
    expect(frame.children[0]?.id).toBe("mine");
    expect(frame.children).toHaveLength(4);
    expect(frame.children[2]?.id).toBe("rect-1");
  });

  test("inserts at document root with null parent", async () => {
    const { host } = await call("insert_nodes", { parentId: null, nodes: [{ type: "frame" }] });
    expect(host.doc().children).toHaveLength(2);
  });

  test("invalid node reports path and hint, and changes nothing", async () => {
    const { host, data, isError } = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [{ type: "text" }],
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("invalid_node");
    expect(data.error.message).toContain("content");
    expect(data.error.hint).toContain("Node format");
    expect(host.calls.applyOps).toHaveLength(0);
  });

  test("unknown prop produces a warning, not a failure", async () => {
    const { data, isError } = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [{ type: "rectangle", fontSize: 12 }],
    });
    expect(isError).toBe(false);
    expect(data.warnings[0]).toContain("nodes[0].fontSize");
  });

  test("non-container parent errors with hint", async () => {
    const { data, isError } = await call("insert_nodes", {
      parentId: "rect-1",
      nodes: [{ type: "ellipse" }],
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("parent_not_container");
    expect(data.error.hint).toContain("frame");
  });

  test("duplicate supplied id errors", async () => {
    const { data } = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [{ type: "ellipse", id: "rect-1" }],
    });
    expect(data.error.code).toBe("duplicate_id");
  });

  test("ref to a non-component is rejected, ref to a component works", async () => {
    const bad = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [{ type: "ref", ref: "rect-1" }],
    });
    expect(bad.data.error.code).toBe("ref_target_invalid");
    expect(bad.data.error.hint).toContain("reusable");

    const host = createFakeHost();
    await call("update_node", { id: "rect-1", props: { reusable: true } }, host);
    const good = await call(
      "insert_nodes",
      { parentId: "frame-1", nodes: [{ type: "ref", ref: "rect-1", x: 5 }] },
      host,
    );
    expect(good.isError).toBe(false);
  });

  test("component and instance can be created in one call", async () => {
    const { isError } = await call("insert_nodes", {
      parentId: "frame-1",
      nodes: [
        { type: "rectangle", id: "comp", reusable: true },
        { type: "ref", ref: "comp" },
      ],
    });
    expect(isError).toBe(false);
  });
});

describe("update_node / replace_node / move_node / delete_nodes", () => {
  test("update merges props and null unsets", async () => {
    const { host, isError, data } = await call("update_node", {
      id: "rect-1",
      props: { fill: "#ff0000", cornerRadius: null },
    });
    expect(isError).toBe(false);
    expect(data.updated).toEqual(["fill", "cornerRadius"]);
    const node = findNode(host.doc(), "rect-1") as Json;
    expect(node.fill).toBe("#ff0000");
    expect(node.cornerRadius).toBeUndefined();
    expect(host.calls.focus.at(-1)).toEqual(["rect-1"]);
  });

  test("update errors: bad value, forbidden key, missing node", async () => {
    const bad = await call("update_node", { id: "rect-1", props: { fill: "red" } });
    expect(bad.data.error.code).toBe("invalid_props");
    expect(bad.data.error.hint).toContain("hex");
    const forbidden = await call("update_node", { id: "rect-1", props: { type: "ellipse" } });
    expect(forbidden.data.error.code).toBe("invalid_props");
    const missing = await call("update_node", { id: "zzz", props: { fill: "#fff" } });
    expect(missing.data.error.code).toBe("node_not_found");
    const noProps = await call("update_node", { id: "rect-1" });
    expect(noProps.data.error.code).toBe("invalid_input");
  });

  test("replace keeps id by default and assigns ids inside", async () => {
    const { host, data, isError } = await call("replace_node", {
      id: "rect-1",
      node: { type: "frame", name: "New", children: [{ type: "text", content: "x" }] },
    });
    expect(isError).toBe(false);
    expect(data.created.id).toBe("rect-1");
    expect(data.created.children).toHaveLength(1);
    expect((findNode(host.doc(), "rect-1") as Json).type).toBe("frame");
  });

  test("replace missing node errors", async () => {
    const { data } = await call("replace_node", { id: "zzz", node: { type: "frame" } });
    expect(data.error.code).toBe("node_not_found");
  });

  test("move reorders and reparents, cycle is rejected", async () => {
    const host = createFakeHost();
    await call(
      "insert_nodes",
      { parentId: "frame-1", nodes: [{ type: "frame", id: "box" }] },
      host,
    );
    const moved = await call("move_node", { id: "text-1", parentId: "box", index: 0 }, host);
    expect(moved.isError).toBe(false);
    expect((findNode(host.doc(), "box") as Json).children[0].id).toBe("text-1");

    const cycle = await call("move_node", { id: "frame-1", parentId: "box" }, host);
    expect(cycle.data.error.code).toBe("cycle");
    expect(cycle.data.error.hint).toContain("descendants");
  });

  test("delete removes many, ignores nested ids, focuses the parent", async () => {
    const host = createFakeHost();
    const { data, isError } = await call(
      "delete_nodes",
      { ids: ["rect-1", "frame-1", "text-1"] },
      host,
    );
    expect(isError).toBe(false);
    expect(data.deleted).toEqual(["frame-1"]);
    expect(host.doc().children).toHaveLength(0);
  });

  test("delete with a missing id is atomic", async () => {
    const host = createFakeHost();
    const { data, isError } = await call("delete_nodes", { ids: ["rect-1", "ghost"] }, host);
    expect(isError).toBe(true);
    expect(data.error.code).toBe("node_not_found");
    expect(data.error.message).toContain("op 1");
    expect(findNode(host.doc(), "rect-1")).not.toBeNull();
  });
});

describe("set_variables", () => {
  test("sets, strips $, and removes", async () => {
    const host = createFakeHost();
    const set = await call(
      "set_variables",
      {
        variables: {
          $accent: { type: "color", value: "#0E7C5A" },
          gap: { type: "number", value: 8 },
        },
      },
      host,
    );
    expect(set.isError).toBe(false);
    expect(Object.keys(host.doc().variables).sort()).toEqual(["accent", "gap"]);
    await call("set_variables", { variables: { gap: null } }, host);
    expect(Object.keys(host.doc().variables)).toEqual(["accent"]);
  });

  test("rejects an invalid color value", async () => {
    const { data, isError } = await call("set_variables", {
      variables: { accent: { type: "color", value: "green" } },
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("invalid_input");
  });
});

describe("apply_ops", () => {
  test("applies a batch in one host call and returns created ids", async () => {
    const host = createFakeHost();
    const { data, isError } = await call(
      "apply_ops",
      {
        ops: [
          { op: "setVariables", variables: { brand: { type: "color", value: "#112233" } } },
          {
            op: "insert",
            parentId: "frame-1",
            node: { type: "frame", name: "Card", reusable: true },
          },
          { op: "update", id: "rect-1", props: { fill: "$brand" } },
          { op: "delete", id: "text-1" },
        ],
      },
      host,
    );
    expect(isError).toBe(false);
    expect(host.calls.applyOps).toHaveLength(1);
    expect(data.applied).toBe(4);
    expect(data.created[0].op).toBe(1);
    expect(findNode(host.doc(), data.created[0].nodes[0].id)).not.toBeNull();
    expect(findNode(host.doc(), "text-1")).toBeNull();
  });

  test("later ops can use ids supplied in earlier ops", async () => {
    const { isError, host } = await call("apply_ops", {
      ops: [
        { op: "insert", parentId: "frame-1", node: { type: "frame", id: "a" } },
        { op: "insert", parentId: "a", node: { type: "text", content: "x" } },
        { op: "move", id: "rect-1", parentId: "a", index: 0 },
      ],
    });
    expect(isError).toBe(false);
    expect((findNode(host.doc(), "a") as Json).children).toHaveLength(2);
  });

  test("is atomic: a failing op leaves the document untouched and names the op", async () => {
    const host = createFakeHost();
    const before: PegoDocument = host.doc();
    const { data, isError } = await call(
      "apply_ops",
      {
        ops: [
          { op: "update", id: "rect-1", props: { fill: "#000000" } },
          { op: "delete", id: "ghost" },
        ],
      },
      host,
    );
    expect(isError).toBe(true);
    expect(data.error.code).toBe("node_not_found");
    expect(data.error.message).toContain("op 1 (delete ghost)");
    expect(host.doc()).toBe(before);
    expect(host.calls.applyOps).toHaveLength(0);
  });

  test("malformed op reports its index", async () => {
    const { data, isError } = await call("apply_ops", {
      ops: [{ op: "update", id: "rect-1", props: {} }, { op: "explode" }],
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("invalid_op");
    expect(data.error.message).toContain("ops[1]");
  });

  test("empty ops rejected", async () => {
    const { data } = await call("apply_ops", { ops: [] });
    expect(data.error.code).toBe("invalid_input");
  });
});

describe("report_plan / report_step / ask_user", () => {
  test("report_plan forwards steps; duplicate ids fail", async () => {
    const host = createFakeHost();
    const ok = await call(
      "report_plan",
      {
        steps: [
          { id: "s1", title: "A" },
          { id: "s2", title: "B", detail: "x" },
        ],
      },
      host,
    );
    expect(ok.isError).toBe(false);
    expect(host.calls.plans[0]).toHaveLength(2);
    const dup = await call(
      "report_plan",
      {
        steps: [
          { id: "s1", title: "A" },
          { id: "s1", title: "B" },
        ],
      },
      host,
    );
    expect(dup.data.error.code).toBe("duplicate_step_id");
    const empty = await call("report_plan", { steps: [] }, host);
    expect(empty.data.error.code).toBe("invalid_input");
  });

  test("report_step forwards status and summary; bad status fails", async () => {
    const host = createFakeHost();
    const ok = await call("report_step", { stepId: "s1", status: "done", summary: "built" }, host);
    expect(ok.isError).toBe(false);
    expect(host.calls.steps[0]).toEqual(["s1", "done", "built"]);
    const bad = await call("report_step", { stepId: "s1", status: "finished" }, host);
    expect(bad.data.error.code).toBe("invalid_input");
  });

  test("ask_user waits on the host and returns the choice", async () => {
    const host = createFakeHost(undefined, (r) => r.options[1] ?? "");
    const { data, isError } = await call(
      "ask_user",
      { question: "Which style?", options: ["Dark", "Light"] },
      host,
    );
    expect(isError).toBe(false);
    expect(data.choice).toBe("Light");
    expect(host.asked[0]?.question).toBe("Which style?");
  });

  test("ask_user needs 2 to 4 options", async () => {
    const one = await call("ask_user", { question: "q", options: ["a"] });
    expect(one.data.error.code).toBe("invalid_input");
    const five = await call("ask_user", { question: "q", options: ["a", "b", "c", "d", "e"] });
    expect(five.data.error.code).toBe("invalid_input");
  });
});
