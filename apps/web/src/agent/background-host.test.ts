/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { emptyHistory, findNode, sampleDoc } from "@pego/doc";
import type { BridgeToEditor, EditorToBridge } from "@pego/agent";
import { useDocumentStore } from "@/store/use-document-store";
import { backgroundSnapshot, SCRATCH_ID, useWorkspaceStore } from "@/workspace/use-workspace-store";
import { cancelBackgroundSaves } from "./background-host";
import { createBridgeHandlers } from "./bridge-handlers";
import { resetStores } from "./test-utils";

const shop = { id: "shp00001", name: "Shop", dir: "/d/shop", mainFile: "/d/shop/project.pego" };
const shopDoc = { ...sampleDoc, name: "Shop" };

const call = (callId: string, fill: string, target?: { project: typeof shop }) =>
  ({
    type: "tool_call",
    callId,
    tool: "update_node",
    input: { id: "rect-1", props: { fill } },
    source: { kind: "mcp" },
    ...(target ? { target } : {}),
  }) satisfies BridgeToEditor;

const fillOf = (doc: typeof sampleDoc) => (findNode(doc, "rect-1") as { fill?: unknown }).fill;

beforeEach(() => {
  resetStores();
  useWorkspaceStore.setState({
    liveId: SCRATCH_ID,
    view: "editor",
    workspaces: [
      { id: SCRATCH_ID, name: "Scratch", dir: null, kind: "scratch", saved: null },
      {
        id: shop.id,
        name: shop.name,
        dir: shop.dir,
        kind: "project",
        saved: {
          tabs: [{ id: "t1", snapshot: null }],
          activeId: "t1",
          live: {
            doc: shopDoc,
            history: emptyHistory(),
            selection: [],
            camera: { panX: 0, panY: 0, zoom: 1 },
            file: {
              fileName: "project.pego",
              handle: null,
              bridgePath: shop.mainFile,
              savedDoc: shopDoc,
            },
          },
        },
      },
    ],
  });
});
afterEach(cancelBackgroundSaves);

describe("tool calls that name a project", () => {
  test("edit that project in the background; the shown document is untouched", async () => {
    const sent: EditorToBridge[] = [];
    const handlers = createBridgeHandlers({ send: (m) => (sent.push(m), true) });
    const shown = useDocumentStore.getState().doc;
    await handlers.handleMessage(call("1", "#112233", { project: shop }));
    expect(sent[0]).toMatchObject({ type: "tool_result", callId: "1", isError: false });
    const snapshot = backgroundSnapshot(shop.id)!;
    expect(fillOf(snapshot.doc)).toBe("#112233");
    expect(snapshot.history.past).toHaveLength(1);
    // Unsaved until the background save writes it.
    expect(snapshot.file.savedDoc).not.toBe(snapshot.doc);
    expect(useDocumentStore.getState().doc).toBe(shown);
  });

  test("without a project the shown document is edited, as before", async () => {
    const handlers = createBridgeHandlers({ send: () => true });
    await handlers.handleMessage(call("1", "#445566"));
    expect(fillOf(useDocumentStore.getState().doc)).toBe("#445566");
    expect(fillOf(backgroundSnapshot(shop.id)!.doc)).toBe(fillOf(shopDoc));
  });

  test("the shown project is edited live", async () => {
    useWorkspaceStore.setState((state) => ({
      liveId: shop.id,
      workspaces: state.workspaces.map((w) => (w.id === shop.id ? { ...w, saved: null } : w)),
    }));
    const handlers = createBridgeHandlers({ send: () => true });
    await handlers.handleMessage(call("1", "#778899", { project: shop }));
    expect(fillOf(useDocumentStore.getState().doc)).toBe("#778899");
  });

  test("a project that is not open and cannot be read is reported", async () => {
    const sent: EditorToBridge[] = [];
    const handlers = createBridgeHandlers({ send: (m) => (sent.push(m), true) });
    const other = { ...shop, id: "oth00001", name: "Other", mainFile: "/d/other/project.pego" };
    await handlers.handleMessage(call("1", "#000000", { project: other }));
    expect(sent[0]).toMatchObject({ isError: true });
    expect((sent[0] as { content: string }).content).toStartWith("Could not load project Other");
  });
});
