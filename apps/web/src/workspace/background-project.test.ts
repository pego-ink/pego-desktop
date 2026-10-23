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
};

beforeEach(() => resetLiveDocument());

describe("a project edited from a terminal agent", () => {
  test("its design loads with the project's id; a missing file starts a new design", async () => {
    const loaded = await loadProjectSnapshot(project, async () => serializeDocument(sampleDoc));
    expect(loaded.doc.id).toBe("proj1234");
    expect(loaded.file).toMatchObject({ fileName: "project.pego", bridgePath: project.mainFile });
    // Adopting the id is a change the next save writes.
    expect(loaded.file.savedDoc).not.toBe(loaded.doc);
    const fresh = await loadProjectSnapshot(project, async () => null);
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
});
