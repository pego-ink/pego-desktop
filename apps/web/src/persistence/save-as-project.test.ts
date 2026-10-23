/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import type { ProjectInfo } from "@pego/agent";
import { useAgentStore } from "@/agent/use-agent-store";
import {
  createMemorySessionBackend,
  listSessions,
  saveSession,
  setSessionBackend,
} from "@/agent/sessions/session-db";
import type { StoredSession } from "@/agent/sessions/session-model";
import { useDocumentStore } from "@/store/use-document-store";
import { resetLiveDocument, TEST_TAB_ID } from "@/workspace/test-reset";
import { openProjectWorkspace, useWorkspaceStore } from "@/workspace/use-workspace-store";
import { parseDocumentFile } from "./file-format";
import { saveAsProject, type SaveAsProjectBridge } from "./save-as-project";
import { useFileStore } from "./use-file-store";

const shop: ProjectInfo = {
  id: "shop1234",
  name: "Shop",
  dir: "/design/shop",
  mainFile: "/design/shop/project.pego",
  hasMainFile: false,
  relativeDir: "shop",
  fileCount: 0,
  modifiedAt: 0,
  createdAt: "2026-10-23T00:00:00.000Z",
};

/** A bridge that creates `shop`, keeps written files and opens the project's tab. */
const fakeBridge = () => {
  const files = new Map<string, string>();
  const trashed: string[] = [];
  const calls: SaveAsProjectBridge = {
    createProject: async (name) => ({ ...shop, name }),
    writeFile: async (path, text) => void files.set(path, text),
    openProject: async (project) => openProjectWorkspace(project),
    trashProject: async (id) => void trashed.push(id),
  };
  return { files, trashed, calls };
};

const chat: StoredSession = {
  id: "c1",
  docId: "",
  title: "Build",
  titleCustom: false,
  createdAt: 1,
  updatedAt: 1,
  turns: [],
};

beforeEach(() => {
  resetLiveDocument();
  setSessionBackend(createMemorySessionBackend());
});

describe("Save as project", () => {
  test("writes the shown document as the project's design, with its name and id", async () => {
    const { files, calls } = fakeBridge();
    const pages = useDocumentStore.getState().doc.children.map((page) => page.id);
    expect(await saveAsProject("Shop", calls)).toBe(true);
    const saved = parseDocumentFile(files.get(shop.mainFile)!);
    expect(saved).toMatchObject({ id: "shop1234", name: "Shop" });
    expect(saved.children.map((page) => page.id)).toEqual(pages);
    expect(useWorkspaceStore.getState().liveId).toBe("shop1234");
  });

  test("an untitled document moves into the project: its tab closes", async () => {
    const { calls } = fakeBridge();
    await saveAsProject("Shop", calls);
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(["shop1234"]);
  });

  test("a document with a file keeps its tab (a copy goes into the project)", async () => {
    useFileStore.setState({ bridgePath: "/work/landing.pego", fileName: "landing.pego" });
    const { calls } = fakeBridge();
    await saveAsProject("Shop", calls);
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual([
      TEST_TAB_ID,
      "shop1234",
    ]);
  });

  test("a failed write keeps everything as it was", async () => {
    const { calls, trashed } = fakeBridge();
    const failing = {
      ...calls,
      writeFile: async () => {
        throw new Error("disk full");
      },
    };
    expect(await saveAsProject("Shop", failing)).toBe(false);
    const { workspaces, liveId } = useWorkspaceStore.getState();
    expect(liveId).toBe(TEST_TAB_ID);
    expect(workspaces).toHaveLength(1);
    expect(trashed).toEqual(["shop1234"]);
  });

  test("a running agent refuses before any project is created", async () => {
    const created: string[] = [];
    const { calls } = fakeBridge();
    useAgentStore.setState({
      liveSessions: { s1: { id: "s1", status: "running" } as never },
    });
    const spy = { ...calls, createProject: async (n: string) => (created.push(n), shop) };
    expect(await saveAsProject("Shop", spy)).toBe(false);
    expect(created).toEqual([]);
    useAgentStore.setState({ liveSessions: {} });
  });

  test("an untitled document's chats follow it to the project", async () => {
    const docId = useDocumentStore.getState().doc.id;
    await saveSession({ ...chat, docId });
    const { calls } = fakeBridge();
    await saveAsProject("Shop", calls);
    expect((await listSessions("shop1234")).map((s) => s.id)).toEqual(["c1"]);
    expect(await listSessions(docId)).toEqual([]);
  });

  test("an edit that landed in the original tab keeps it open", async () => {
    const { calls } = fakeBridge();
    const racing = {
      ...calls,
      writeFile: async (path: string, text: string) => {
        await calls.writeFile(path, text);
        useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 11 } }]);
      },
    };
    await saveAsProject("Shop", racing);
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual([
      TEST_TAB_ID,
      "shop1234",
    ]);
  });
});
