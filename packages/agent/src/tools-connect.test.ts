import { describe, expect, test } from "bun:test";
import { computeLayout, findNode, type PegoDocument } from "@pego/doc";
import { checkLayout } from "./inspect/check-layout";
import { serializeDocument } from "./serialize";
import { createFakeHost } from "./test-host";
import { toolByName } from "./tools";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const flowDoc: PegoDocument = {
  version: 9,
  id: "d",
  name: "Flow",
  variables: {},
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
          id: "login",
          name: "Login",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
          layout: "none",
          children: [
            {
              type: "frame",
              id: "btn",
              name: "Masuk",
              x: 20,
              y: 700,
              width: 350,
              height: 52,
              layout: "none",
              children: [],
            },
          ],
        },
        {
          type: "frame",
          id: "home",
          name: "Beranda",
          x: 470,
          y: 0,
          width: 390,
          height: 844,
          layout: "none",
          children: [],
        },
      ],
    },
  ],
};

const call = async (name: string, input: unknown, host = createFakeHost(flowDoc)) => {
  const result = await toolByName(name)!.run(input, host);
  return { host, isError: result.isError, data: JSON.parse(result.content) as Json };
};

describe("connect_nodes", () => {
  test("draws labelled connectors on top of the page, in one step", async () => {
    const { host, isError, data } = await call("connect_nodes", {
      connections: [{ from: "btn", to: "home", label: "Tap Masuk", toSide: "left" }],
    });
    expect(isError).toBe(false);
    expect(host.calls.applyOps).toHaveLength(1);
    const id = data.created[0] as string;
    expect(host.doc().children[0]!.children.at(-1)?.id).toBe(id);
    expect(findNode(host.doc(), id)).toMatchObject({
      type: "connector",
      from: { id: "btn" },
      to: { id: "home", side: "left" },
      label: "Tap Masuk",
    });
    const layout = computeLayout(host.doc(), () => ({ width: 0, height: 0 }));
    expect(layout.get(id)).toBeDefined();
    const text = serializeDocument(host.doc());
    expect(text).toContain(`connector#${id} from=btn to=home(left) label="Tap Masuk"`);
  });

  test("refuses unknown layers and self-connections without changing anything", async () => {
    const missing = await call("connect_nodes", { connections: [{ from: "btn", to: "nope" }] });
    expect(missing.data.error.code).toBe("node_not_found");
    const self = await call("connect_nodes", { connections: [{ from: "home", to: "home" }] });
    expect(self.isError).toBe(true);
    expect(self.host.calls.applyOps).toHaveLength(0);
  });

  test("deleting a screen deletes its connectors; check_layout flags a dangling one", async () => {
    const { host, data } = await call("connect_nodes", {
      connections: [{ from: "btn", to: "home" }],
    });
    const id = data.created[0] as string;
    const deleted = await call("delete_nodes", { ids: ["login"] }, host);
    expect(deleted.data.connectorsDeleted).toEqual([id]);
    expect(findNode(host.doc(), id)).toBeNull();

    const dangling: PegoDocument = {
      ...flowDoc,
      children: [
        {
          ...flowDoc.children[0]!,
          children: [
            ...flowDoc.children[0]!.children,
            { type: "connector", id: "c", x: 0, y: 0, from: { id: "home" }, to: { id: "gone" } },
          ],
        },
      ],
    };
    const issues = checkLayout(
      dangling,
      computeLayout(dangling, () => ({ width: 0, height: 0 })),
    ).issues;
    expect(issues.find((i) => i.nodeId === "c")?.issue).toContain('"gone"');
    expect(issues.filter((i) => i.nodeId === "c")).toHaveLength(1);
  });

  test("batch_design delete takes attached connectors too", async () => {
    const { host, data } = await call("connect_nodes", {
      connections: [{ from: "login", to: "home" }],
    });
    const id = data.created[0] as string;
    await call("batch_design", { operations: [{ op: "delete", target: "home" }] }, host);
    expect(findNode(host.doc(), id)).toBeNull();
  });
});
