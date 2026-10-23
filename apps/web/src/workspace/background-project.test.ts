/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { findNode, sampleDoc } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { serializeDocument } from "@/persistence/file-format";
import { loadProjectSnapshot, projectTarget } from "./background-project";
import { commitToTarget, readTarget } from "./document-target";
import { resetLiveDocument, TEST_TAB_ID } from "./test-reset";
import { useWorkspaceStore } from "./use-workspace-store";

const project = {
  id: "proj1234",
  name: "Shop",
  dir: "/design/shop",
  mainFile: "/design/shop/project.pego",
  hasMainFile: false,
};
const existing = { ...project, hasMainFile: true };

beforeEach(() => resetLiveDocument());

describe("a project edited from a terminal agent", () => {
  test("its design loads with the project's id; a missing file starts a new design", async () => {
    const loaded = await loadProjectSnapshot(existing, async () => serializeDocument(sampleDoc));
    expect(loaded.doc.id).toBe("proj1234");
    expect(loaded.file).toMatchObject({ fileName: "project.pego", bridgePath: project.mainFile });
    // Adopting the id is a change the next save writes.
    expect(loaded.file.savedDoc).not.toBe(loaded.doc);
    const unread = async () => {
      throw new Error("unread");
    };
    const fresh = await loadProjectSnapshot(project, unread);
    expect(fresh.doc).toMatchObject({ id: "proj1234", name: "Shop" });
  });

  test("without a tab it gets one in the background; edits land there, not in the shown document", async () => {
    const shownBefore = useDocumentStore.getState().doc;
    const target = await projectTarget(project);
    const { workspaces, liveId } = useWorkspaceStore.getState();
    expect(liveId).toBe(TEST_TAB_ID);
    expect(workspaces.map((w) => [w.id, w.kind])).toEqual([
      [TEST_TAB_ID, "local"],
      ["proj1234", "project"],
    ]);
    const page = readTarget(target)!.doc.children[0]!.id;
    expect(
      commitToTarget(target, [
        {
          op: "insert",
          parentId: page,
          node: { type: "rectangle", id: "made-by-agent", x: 0, y: 0 },
        },
      ]),
    ).toBe(true);
    expect(findNode(readTarget(target)!.doc, "made-by-agent")).not.toBeNull();
    expect(useDocumentStore.getState().doc).toBe(shownBefore);
    // A second call reuses the tab.
    expect(await projectTarget(project)).toEqual(target);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  test("parallel calls for the same project open one tab", async () => {
    const [a, b] = await Promise.all([projectTarget(project), projectTarget(project)]);
    expect(a).toEqual(b);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  test("a design file that cannot be read is an error, never an empty design", async () => {
    const failing = async () => {
      throw new Error("too big");
    };
    await expect(projectTarget(existing, failing)).rejects.toThrow("too big");
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    await expect(loadProjectSnapshot(existing, async () => "not json")).rejects.toThrow();
  });

  test("a project the user opened while its file was being read keeps the live tab's document", async () => {
    const read = async () => {
      useWorkspaceStore.setState((state) => ({
        workspaces: [
          ...state.workspaces.filter((w) => w.id !== TEST_TAB_ID),
          { id: "proj1234", kind: "project", name: "Shop", dir: project.dir, saved: null },
        ],
        liveId: "proj1234",
      }));
      return serializeDocument(sampleDoc);
    };
    const target = await projectTarget(existing, read);
    expect(target).toEqual({
      workspaceId: "proj1234",
      docId: useDocumentStore.getState().doc.id,
    });
    expect(useWorkspaceStore.getState().workspaces[0]?.saved).toBeNull();
  });

  test("a live project tab is never reloaded from disk", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "proj1234", kind: "project", name: "Shop", dir: project.dir, saved: null },
      ],
      liveId: "proj1234",
    });
    const read = async () => {
      throw new Error("must not read");
    };
    expect(await projectTarget(existing, read)).toEqual({
      workspaceId: "proj1234",
      docId: useDocumentStore.getState().doc.id,
    });
  });
});
