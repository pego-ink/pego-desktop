import { describe, expect, test } from "bun:test";
import { findNode, resolveInstance, type PegoDocument, type PegoNode } from "@pego/doc";
import { createFakeHost } from "./test-host";
import { editTools } from "./tools-edit";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const call = async (name: string, input: unknown, host = createFakeHost()) => {
  const tool = editTools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.run(input, host);
  return { host, isError: result.isError, data: JSON.parse(result.content) as Json };
};

const node = (doc: PegoDocument, id: string): Json => {
  const found = findNode(doc, id);
  if (!found) throw new Error(`missing ${id}`);
  return found as unknown as Json;
};

/** Sample doc plus a button component (frame#btn: rect#bg + text#label) at the root. */
const withComponent = async () => {
  const host = createFakeHost();
  const { data } = await call(
    "batch_design",
    {
      operations: [
        {
          op: "insert",
          parent: null,
          as: "btn",
          node: {
            type: "frame",
            name: "Button",
            width: 120,
            height: 40,
            layout: "horizontal",
            children: [
              { type: "rectangle", id: "bg", width: 120, height: 40, fill: "#0E7C5A" },
              { type: "text", id: "label", content: "Click", fontSize: 14 },
            ],
          },
        },
      ],
    },
    host,
  );
  const id = data.aliases.btn as string;
  await call("create_component", { nodeId: id }, host);
  return { host, componentId: id };
};

describe("editTools registry", () => {
  test("names, object schemas, descriptions", () => {
    expect(editTools.map((t) => t.name)).toEqual([
      "batch_design",
      "create_component",
      "create_instance",
      "set_instance_overrides",
      "detach_instance",
      "copy_nodes",
      "create_page",
      "go_to_page",
    ]);
    for (const tool of editTools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(() => JSON.stringify(tool.inputSchema)).not.toThrow();
    }
    expect(editTools[0]?.description).toContain("@alias");
    expect(editTools[0]?.description).toContain("whole section");
  });
});

describe("batch_design", () => {
  test("resolves aliases across operations with one applyOps call", async () => {
    const host = createFakeHost();
    const { data, isError } = await call(
      "batch_design",
      {
        operations: [
          {
            op: "insert",
            parent: "frame-1",
            as: "card",
            node: { type: "frame", layout: "vertical", gap: 8, width: 200, height: 120 },
          },
          { op: "insert", parent: "@card", as: "title", node: { type: "text", content: "Hi" } },
          { op: "update", target: "@title", props: { content: "Hello", fontSize: 20 } },
          { op: "copy", source: "@card", parent: "frame-1", overrides: { x: 300 }, as: "card2" },
          { op: "move", target: "@title", parent: "@card2", index: 0 },
          { op: "delete", target: "rect-1" },
        ],
      },
      host,
    );
    expect(isError).toBe(false);
    expect(data.ok).toBe(true);
    expect(host.calls.applyOps).toHaveLength(1);
    expect(host.calls.applyOps[0]).toHaveLength(6);
    const { card, title, card2 } = data.aliases as { card: string; title: string; card2: string };
    const doc = host.doc();
    expect(node(doc, title).content).toBe("Hello");
    expect(findNode(doc, title)).not.toBeNull();
    const copy = node(doc, card2);
    expect(copy.x).toBe(300);
    expect(copy.children).toHaveLength(2);
    expect(copy.children[0].id).toBe(title);
    expect(node(doc, card).children).toEqual([]);
    expect(findNode(doc, "rect-1")).toBeNull();
    expect(data.created.map((c: Json) => c.alias)).toEqual(["card", "title", "card2"]);
    expect(host.calls.focus).toHaveLength(1);
    expect(host.calls.focus[0]).toContain(card);
    expect(host.calls.focus[0]).not.toContain("rect-1");
  });

  test("replace keeps the target id and can be aliased; alias accepts a leading @", async () => {
    const host = createFakeHost();
    const { data } = await call(
      "batch_design",
      {
        operations: [
          {
            op: "replace",
            target: "rect-1",
            as: "@swapped",
            node: { type: "ellipse", width: 50, height: 50 },
          },
        ],
      },
      host,
    );
    expect(data.aliases.swapped).toBe("rect-1");
    expect(node(host.doc(), "rect-1").type).toBe("ellipse");
  });

  test("failure is atomic: names the operation, applies nothing", async () => {
    const host = createFakeHost();
    const before = host.doc();
    const { data, isError } = await call(
      "batch_design",
      {
        operations: [
          { op: "insert", parent: "frame-1", as: "ok", node: { type: "rectangle" } },
          { op: "update", target: "text-1", props: { fontSize: 99 } },
          { op: "delete", target: "ghost" },
        ],
      },
      host,
    );
    expect(isError).toBe(true);
    expect(data.error.code).toBe("node_not_found");
    expect(data.error.message).toContain("operation 2 (delete)");
    expect(data.error.message).toContain("Nothing was applied");
    expect(data.error.hint).toContain("get_document");
    expect(host.calls.applyOps).toHaveLength(0);
    expect(host.calls.focus).toHaveLength(0);
    expect(host.doc()).toBe(before);
  });

  test("unknown and duplicate aliases fail with a hint", async () => {
    const unknown = await call("batch_design", {
      operations: [{ op: "insert", parent: "@nope", node: { type: "rectangle" } }],
    });
    expect(unknown.data.error.code).toBe("unknown_alias");
    expect(unknown.data.error.message).toContain("operation 0 (insert)");
    expect(unknown.data.error.hint).toContain("`as`");
    expect(unknown.host.calls.applyOps).toHaveLength(0);

    const dup = await call("batch_design", {
      operations: [
        { op: "insert", parent: null, as: "a", node: { type: "frame" } },
        { op: "insert", parent: null, as: "a", node: { type: "frame" } },
      ],
    });
    expect(dup.data.error.code).toBe("duplicate_alias");
    expect(dup.data.error.message).toContain("operation 1 (insert as @a)");
  });

  test("invalid node and invalid input", async () => {
    const bad = await call("batch_design", {
      operations: [{ op: "insert", parent: null, node: { type: "text" } }],
    });
    expect(bad.data.error.code).toBe("invalid_node");
    expect(bad.data.error.message).toContain("operation 0");

    const noOp = await call("batch_design", { operations: [{ target: "x" }] });
    expect(noOp.data.error.code).toBe("invalid_input");
    expect((await call("batch_design", { operations: [] })).data.error.code).toBe("invalid_input");

    const tooMany = await call("batch_design", {
      operations: Array.from({ length: 201 }, () => ({ op: "delete", target: "rect-1" })),
    });
    expect(tooMany.data.error.code).toBe("invalid_input");
  });

  test("a ref into a component created by an alias in the same batch", async () => {
    const host = createFakeHost();
    const { data, isError } = await call(
      "batch_design",
      {
        operations: [
          {
            op: "insert",
            parent: null,
            as: "chip",
            node: {
              type: "frame",
              reusable: true,
              width: 80,
              height: 24,
              children: [{ type: "text", id: "t", content: "tag" }],
            },
          },
          {
            op: "instance",
            component: "@chip",
            parent: "frame-1",
            props: { x: 10, y: 10, width: 100 },
            overrides: { t: { content: "new" } },
            as: "chip1",
          },
          { op: "instance", component: "@chip", parent: "frame-1", props: { x: 10, y: 50 } },
        ],
      },
      host,
    );
    expect(isError).toBe(false);
    expect(host.calls.applyOps).toHaveLength(1);
    const inst = node(host.doc(), data.aliases.chip1);
    expect(inst.type).toBe("ref");
    expect(inst.ref).toBe(data.aliases.chip);
    expect(inst.width).toBe(100);
    expect(inst.descendants).toEqual({ t: { content: "new" } });
  });

  test("instance op rejects bad component, bad override target, and cycles", async () => {
    const notReusable = await call("batch_design", {
      operations: [{ op: "instance", component: "frame-1", parent: null }],
    });
    expect(notReusable.data.error.code).toBe("not_a_component");

    const { host, componentId } = await withComponent();
    const badTarget = await call(
      "batch_design",
      {
        operations: [
          {
            op: "instance",
            component: componentId,
            parent: null,
            overrides: { nope: { fill: "#fff" } },
          },
        ],
      },
      host,
    );
    expect(badTarget.data.error.code).toBe("invalid_override_target");
    expect(badTarget.data.error.hint).toContain("label");

    const cycle = await call(
      "batch_design",
      { operations: [{ op: "instance", component: componentId, parent: componentId }] },
      host,
    );
    expect(cycle.data.error.code).toBe("instance_cycle");
  });
});

describe("components and instances", () => {
  test("create_component marks reusable, rejects wrong targets", async () => {
    const host = createFakeHost();
    const done = await call("create_component", { nodeId: "frame-1", name: "Screen" }, host);
    expect(done.isError).toBe(false);
    expect(node(host.doc(), "frame-1").reusable).toBe(true);
    expect(node(host.doc(), "frame-1").name).toBe("Screen");
    expect(host.calls.focus.at(-1)).toEqual(["frame-1"]);

    const again = await call("create_component", { nodeId: "frame-1" }, host);
    expect(again.data.error.code).toBe("already_component");
    const rect = await call("create_component", { nodeId: "rect-1" }, host);
    expect(rect.data.error.code).toBe("invalid_component");
    const missing = await call("create_component", { nodeId: "zzz" }, host);
    expect(missing.data.error.code).toBe("node_not_found");
  });

  test("create_component rejects nodes inside an instance", async () => {
    const { host, componentId } = await withComponent();
    const inst = await call("create_instance", { componentId, parentId: "frame-1" }, host);
    const inside = await call("create_component", { nodeId: `${inst.data.id}/bg` }, host);
    expect(inside.data.error.code).toBe("node_not_found");
    expect(inside.data.error.message).toContain("inside a component instance");
  });

  test("create_instance, set_instance_overrides, detach_instance round trip", async () => {
    const { host, componentId } = await withComponent();
    const created = await call(
      "create_instance",
      {
        componentId,
        parentId: "frame-1",
        index: 0,
        x: 40,
        y: 400,
        width: 200,
        overrides: { label: { content: "Buy" } },
      },
      host,
    );
    expect(created.isError).toBe(false);
    const instanceId = created.data.id as string;
    expect(findNode(host.doc(), "frame-1")).not.toBeNull();
    expect(node(host.doc(), "frame-1").children[0].id).toBe(instanceId);
    expect(node(host.doc(), instanceId)).toMatchObject({ type: "ref", x: 40, y: 400, width: 200 });
    expect(host.calls.focus.at(-1)).toEqual([instanceId]);

    // merge: add fill on label, add override on bg; label content kept
    const merged = await call(
      "set_instance_overrides",
      { instanceId, overrides: { label: { fill: "#fff" }, bg: { fill: "#f00" } } },
      host,
    );
    expect(merged.isError).toBe(false);
    expect(node(host.doc(), instanceId).descendants).toEqual({
      label: { content: "Buy", fill: "#fff" },
      bg: { fill: "#f00" },
    });

    // null prop removes one override, null descendant clears
    await call(
      "set_instance_overrides",
      { instanceId, overrides: { label: { fill: null }, bg: null } },
      host,
    );
    expect(node(host.doc(), instanceId).descendants).toEqual({ label: { content: "Buy" } });
    await call("set_instance_overrides", { instanceId, overrides: { label: null } }, host);
    expect(node(host.doc(), instanceId).descendants).toBeUndefined();

    const bad = await call(
      "set_instance_overrides",
      { instanceId, overrides: { ghost: { fill: "#fff" } } },
      host,
    );
    expect(bad.data.error.code).toBe("invalid_override_target");
    const badValue = await call(
      "set_instance_overrides",
      { instanceId, overrides: { label: { fontSize: "huge" } } },
      host,
    );
    expect(badValue.data.error.code).toBe("invalid_override");

    // detach keeps overrides, position and size, with fresh ids
    await call(
      "set_instance_overrides",
      { instanceId, overrides: { label: { content: "Buy" } } },
      host,
    );
    const expected = resolveInstance(host.doc(), node(host.doc(), instanceId) as never);
    const detached = await call("detach_instance", { instanceId }, host);
    expect(detached.isError).toBe(false);
    expect(findNode(host.doc(), instanceId)).toBeNull();
    const newRoot = node(host.doc(), detached.data.created.id);
    expect(newRoot).toMatchObject({ type: "frame", x: 40, y: 400, width: 200 });
    expect(newRoot.reusable).not.toBe(true);
    expect(newRoot.children).toHaveLength(2);
    expect(newRoot.children[1].content).toBe("Buy");
    expect(newRoot.children[0].id).not.toBe("bg");
    expect(newRoot.children.map((c: PegoNode) => c.id)).not.toContain(`${instanceId}/bg`);
    expect(expected?.type).toBe("frame");
    expect(node(host.doc(), "frame-1").children[0].id).toBe(newRoot.id);
  });

  test("create_instance validation", async () => {
    const { host, componentId } = await withComponent();
    const notComponent = await call(
      "create_instance",
      { componentId: "rect-1", parentId: null },
      host,
    );
    expect(notComponent.data.error.code).toBe("not_a_component");
    const missing = await call("create_instance", { componentId: "nope", parentId: null }, host);
    expect(missing.data.error.code).toBe("component_not_found");
    const badOverride = await call(
      "create_instance",
      { componentId, parentId: null, overrides: { zzz: { fill: "#fff" } } },
      host,
    );
    expect(badOverride.data.error.code).toBe("invalid_override_target");
    const badParent = await call("create_instance", { componentId, parentId: "rect-1" }, host);
    expect(badParent.data.error.code).toBe("parent_not_container");
    const selfCycle = await call("create_instance", { componentId, parentId: componentId }, host);
    expect(selfCycle.data.error.code).toBe("instance_cycle");
    const notInstance = await call("detach_instance", { instanceId: "frame-1" }, host);
    expect(notInstance.data.error.code).toBe("not_an_instance");
  });
});

describe("copy_nodes", () => {
  test("copies after the original with default +20/+20 offset", async () => {
    const host = createFakeHost();
    const { data, isError } = await call("copy_nodes", { ids: ["rect-1", "text-1"] }, host);
    expect(isError).toBe(false);
    const doc = host.doc();
    const copyRect = node(doc, data.copies["rect-1"]);
    expect(copyRect).toMatchObject({ type: "rectangle", x: 100, y: 140, fill: "#0E7C5A" });
    expect(copyRect.id).not.toBe("rect-1");
    const children = node(doc, "frame-1").children.map((c: PegoNode) => c.id);
    expect(children).toEqual(["rect-1", data.copies["rect-1"], "text-1", data.copies["text-1"]]);
    expect(host.calls.applyOps).toHaveLength(1);
    expect(host.calls.focus.at(-1)).toEqual([data.copies["rect-1"], data.copies["text-1"]]);
  });

  test("explicit offset, deep copy with fresh ids, copy into another parent", async () => {
    const host = createFakeHost();
    const { data } = await call("copy_nodes", { ids: ["frame-1"], offset: { x: 900, y: 0 } }, host);
    const copy = node(host.doc(), data.copies["frame-1"]);
    expect(copy.x).toBe(900);
    expect(copy.children).toHaveLength(2);
    const ids = copy.children.map((c: PegoNode) => c.id);
    expect(ids).not.toContain("rect-1");
    expect(node(host.doc(), "frame-1").x).toBe(0);

    const into = await call(
      "copy_nodes",
      { ids: ["rect-1", "text-1"], parentId: data.copies["frame-1"], index: 0 },
      host,
    );
    const target = node(host.doc(), data.copies["frame-1"]).children.map((c: PegoNode) => c.id);
    expect(target.slice(0, 2)).toEqual([into.data.copies["rect-1"], into.data.copies["text-1"]]);
  });

  test("no default offset inside flex frames", async () => {
    const host = createFakeHost();
    await call(
      "batch_design",
      {
        operations: [
          {
            op: "insert",
            parent: null,
            as: "row",
            node: {
              type: "frame",
              layout: "horizontal",
              children: [{ type: "rectangle", id: "cell", x: 5, y: 7, width: 10, height: 10 }],
            },
          },
        ],
      },
      host,
    );
    const { data } = await call("copy_nodes", { ids: ["cell"] }, host);
    expect(node(host.doc(), data.copies.cell)).toMatchObject({ x: 5, y: 7 });
    const forced = await call("copy_nodes", { ids: ["cell"], offset: { x: 1, y: 2 } }, host);
    expect(node(host.doc(), forced.data.copies.cell)).toMatchObject({ x: 6, y: 9 });
  });

  test("errors leave the document untouched", async () => {
    const host = createFakeHost();
    const missing = await call("copy_nodes", { ids: ["rect-1", "ghost"] }, host);
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe("node_not_found");
    expect(host.calls.applyOps).toHaveLength(0);
    const badParent = await call("copy_nodes", { ids: ["rect-1"], parentId: "text-1" }, host);
    expect(badParent.data.error.code).toBe("parent_not_container");
    expect(host.calls.applyOps).toHaveLength(0);
  });
});

describe("flipX / flipY", () => {
  test("update and insert accept the mirror flags, and false/null clear them", async () => {
    const host = createFakeHost();
    const inserted = await call(
      "batch_design",
      {
        operations: [
          {
            op: "insert",
            parent: null,
            as: "box",
            node: { type: "rectangle", width: 40, height: 20, flipX: true },
          },
        ],
      },
      host,
    );
    expect(inserted.isError).toBeFalsy();
    const id = inserted.data.aliases.box as string;
    expect(node(host.doc(), id)).toMatchObject({ flipX: true });

    const updated = await call(
      "batch_design",
      { operations: [{ op: "update", target: id, props: { flipY: true, flipX: null } }] },
      host,
    );
    expect(updated.isError).toBeFalsy();
    expect(node(host.doc(), id)).toMatchObject({ flipY: true });
    expect(node(host.doc(), id).flipX).toBeUndefined();
  });

  test("flip props are in the tool schemas", async () => {
    const { editTools: tools } = await import("./tools-edit");
    const text = JSON.stringify(tools.map((t) => t.inputSchema));
    expect(text).toContain("flipX");
    expect(text).toContain("flipY");
  });
});
