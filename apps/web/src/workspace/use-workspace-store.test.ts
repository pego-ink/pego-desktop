/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { insertRect, resetStores } from "@/agent/test-utils";
import { canUndoRunChanges, undoRunChanges } from "@/agent/run";
import { clearRuns, getRun, registerRun } from "@/agent/run-registry";
import { setSessionHome } from "@/agent/sessions/session-home";
import { createToolHost } from "@/agent/tool-host";
import { useAgentStore } from "@/agent/use-agent-store";
import { applyAutosaveRecord, buildAutosaveRecord } from "@/persistence/use-persistence";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { visibleTarget } from "./document-target";
import { captureLive, documentTitle } from "./live-document";
import { releaseWindow, resetLiveDocument, stubConfirm, TEST_TAB_ID } from "./test-reset";
import {
  activateWorkspace,
  closeWorkspace,
  findWorkspace,
  forceCloseWorkspace,
  liveProject,
  newDocumentTab,
  openDocument,
  openProjectWorkspace,
  reorderWorkspaces,
  showDashboard,
  showEditor,
  useWorkspaceStore,
  workspaceIsDirty,
  workspaceRunning,
} from "./use-workspace-store";

const checkout = { id: "chk00001", name: "Checkout", dir: "/repo/design/checkout" };
const shop = { id: "shp00001", name: "Shop", dir: "/repo/design/shop" };
const docs = () => useDocumentStore.getState();
const tabs = () => useWorkspaceStore.getState();
const tabIds = () => tabs().workspaces.map((workspace) => workspace.id);
const title = () => {
  const live = captureLive();
  return documentTitle(live.doc, live.file);
};
const agent = () => useAgentStore.getState();

beforeEach(() => {
  resetStores();
  resetLiveDocument();
  agent().patchSession(agent().visibleSessionId, { status: "idle" });
  stubConfirm(() => true);
});

afterAll(() => {
  clearRuns();
  releaseWindow();
});

/** Start a working run in the visible session, editing the shown tab's document. */
const startRun = (runId: string) => {
  const sessionId = agent().visibleSessionId;
  const target = visibleTarget()!;
  setSessionHome(sessionId, target);
  agent().beginRun(sessionId, runId, "prompt");
  agent().patchSession(sessionId, { status: "running" });
  const host = createToolHost({ runId, target });
  registerRun({
    id: runId,
    sessionId,
    backend: "local",
    controller: new AbortController(),
    host,
    styleId: undefined,
  });
  return host;
};

describe("tabs", () => {
  test("each opened document gets its own tab; switching restores it", () => {
    openDocument({ ...sampleDoc, name: "Notes" }, { fileName: "notes.pego" });
    const notes = tabs().liveId!;
    openProjectWorkspace(checkout);
    expect(tabs()).toMatchObject({ liveId: "chk00001", view: "editor" });
    expect(liveProject()?.name).toBe("Checkout");
    expect(title()).toBe("Untitled");

    activateWorkspace(notes);
    expect(title()).toBe("notes.pego");
    expect(docs().doc.name).toBe("Notes");
    expect(liveProject()).toBeNull();
    expect(tabs().workspaces.map((w) => [w.kind, w.name])).toEqual([
      ["local", "notes.pego"],
      ["project", "Checkout"],
    ]);
  });

  test("undo history, selection, page and camera are per tab", () => {
    const a = TEST_TAB_ID;
    docs().commit([{ op: "update", id: "frame-1", props: { x: 11 } }]);
    docs().select(["frame-1"]);
    useViewportStore.getState().setCamera({ panX: 40, panY: 50, zoom: 2 });
    const b = newDocumentTab();
    expect(docs().history.past).toHaveLength(0);
    expect(docs().selection).toEqual([]);
    const frame = docs().doc.children[0]!.children[0]!.id;
    docs().commit([{ op: "update", id: frame, props: { x: 3 } }]);
    docs().commit([{ op: "update", id: frame, props: { x: 4 } }]);
    useViewportStore.getState().setCamera({ panX: 1, panY: 2, zoom: 0.5 });

    activateWorkspace(a);
    expect(docs().history.past).toHaveLength(1);
    expect(docs().selection).toEqual(["frame-1"]);
    expect(useViewportStore.getState().camera).toEqual({ panX: 40, panY: 50, zoom: 2 });
    docs().undo();
    expect(docs().history.past).toHaveLength(0);

    activateWorkspace(b);
    expect(docs().history.past).toHaveLength(2);
    expect(useViewportStore.getState().camera).toEqual({ panX: 1, panY: 2, zoom: 0.5 });
  });

  test("the dashboard is a view: the live tab stays loaded", () => {
    openProjectWorkspace(checkout);
    showDashboard();
    expect(tabs()).toMatchObject({ view: "dashboard", liveId: "chk00001" });
    showEditor();
    expect(tabs().view).toBe("editor");
  });

  test("reorder keeps every tab; unknown ids are ignored", () => {
    openProjectWorkspace(checkout);
    openProjectWorkspace(shop);
    reorderWorkspaces(["shp00001", "nope", TEST_TAB_ID]);
    expect(tabIds()).toEqual(["shp00001", TEST_TAB_ID, "chk00001"]);
    expect(tabs().liveId).toBe("shp00001");
  });
});

describe("closing tabs", () => {
  test("unsaved changes need a confirmation; forcing drops them", () => {
    openProjectWorkspace(checkout);
    openDocument({ ...sampleDoc, name: "Pay" }, { fileName: "pay.pego" }, { saved: false });
    const pay = tabs().liveId!;
    expect(workspaceIsDirty(findWorkspace(pay)!)).toBe(true);
    expect(closeWorkspace(pay)).toBe("needs-confirm");
    expect(tabIds()).toContain(pay);
    forceCloseWorkspace(pay);
    expect(tabIds()).toEqual([TEST_TAB_ID, "chk00001"]);
    // The live tab was closed: its left neighbour (no right one) is shown.
    expect(tabs().liveId).toBe("chk00001");
    expect(closeWorkspace("chk00001")).toBe("closed");
    expect(tabs().liveId).toBe(TEST_TAB_ID);
  });

  test("a working run needs a confirmation; forcing cancels it first", () => {
    startRun("run-close");
    newDocumentTab();
    expect(workspaceRunning(TEST_TAB_ID)).toBe(true);
    expect(closeWorkspace(TEST_TAB_ID)).toBe("needs-confirm");
    forceCloseWorkspace(TEST_TAB_ID);
    expect(getRun("run-close")).toBeUndefined();
    expect(workspaceRunning(TEST_TAB_ID)).toBe(false);
    expect(tabIds()).toHaveLength(1);
  });

  test("closing the last tab leaves none open and shows Home", () => {
    expect(closeWorkspace(TEST_TAB_ID)).toBe("closed");
    expect(tabs()).toMatchObject({ workspaces: [], liveId: null, view: "dashboard" });
    showEditor();
    expect(tabIds()).toHaveLength(1);
    expect(tabs().view).toBe("editor");
  });
});

describe("runs in background tabs", () => {
  test("a run keeps editing its own document while another tab is shown", () => {
    const host = startRun("run-a");
    const b = newDocumentTab();
    const shownDoc = docs().doc;
    const frame = shownDoc.children[0]!.children[0]!.id;

    host.applyOps([insertRect()]);
    host.newGroup();
    host.applyOps([{ op: "update", id: "frame-1", props: { x: 77 } }]);
    // The shown document (B) is untouched; A's snapshot has the run's transactions.
    expect(docs().doc).toBe(shownDoc);
    const savedA = findWorkspace(TEST_TAB_ID)!.saved!;
    expect(savedA.history.past.map((t) => t.runId)).toEqual(["run-a", "run-a"]);
    expect(host.getDoc()).toBe(savedA.doc);
    expect(workspaceRunning(TEST_TAB_ID)).toBe(true);
    expect(workspaceRunning(b)).toBe(false);

    // The user edits B meanwhile.
    docs().commit([{ op: "update", id: frame, props: { x: 5 } }]);

    activateWorkspace(TEST_TAB_ID);
    expect(docs().doc).toBe(savedA.doc);
    expect(docs().history.past).toHaveLength(2);
    // The run edits the shown store again now that its tab is visible.
    host.applyOps([{ op: "update", id: "frame-1", props: { x: 78 } }]);
    expect(docs().history.past).toHaveLength(2);
    expect(findWorkspace(b)!.saved!.history.past).toHaveLength(1);
  });

  test("Undo all reverts the run in its own document, shown or not", () => {
    const host = startRun("run-u");
    host.applyOps([insertRect()]);
    const before = docs().doc;
    newDocumentTab();
    expect(canUndoRunChanges("run-u")).toEqual({ ok: true });
    expect(undoRunChanges("run-u").ok).toBe(true);
    const savedA = findWorkspace(TEST_TAB_ID)!.saved!;
    expect(savedA.doc).not.toBe(before);
    expect(savedA.history.past.at(-1)?.source).toBe("user");
    expect(docs().history.past).toHaveLength(0);
  });

  test("a closed document makes the run's tools fail instead of editing another one", () => {
    const host = startRun("run-c");
    newDocumentTab();
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.filter((workspace) => workspace.id !== TEST_TAB_ID),
    }));
    expect(() => host.getDoc()).toThrow("closed");
  });
});

describe("persistence", () => {
  test("tab order, the live tab, documents and cameras survive a restart", () => {
    openProjectWorkspace(checkout);
    openDocument({ ...sampleDoc, id: "doc-pay", name: "Pay" }, { fileName: "pay.pego" });
    useViewportStore.getState().setCamera({ panX: 7, panY: 8, zoom: 3 });
    reorderWorkspaces(["chk00001", tabs().liveId!, TEST_TAB_ID]);
    activateWorkspace("chk00001");
    const record = buildAutosaveRecord();
    const order = tabIds();

    resetLiveDocument();
    applyAutosaveRecord(record);
    expect(tabIds()).toEqual(order);
    expect(tabs().liveId).toBe("chk00001");
    const pay = tabs().workspaces[1]!;
    expect(pay.saved?.doc.name).toBe("Pay");
    activateWorkspace(pay.id);
    expect(useFileStore.getState().fileName).toBe("pay.pego");
    expect(useViewportStore.getState().camera).toEqual({ panX: 7, panY: 8, zoom: 3 });
  });

  test("older autosaves with a scratch workspace restore it as a local tab", () => {
    const record = buildAutosaveRecord();
    applyAutosaveRecord({
      ...record,
      workspaces: record.workspaces!.map((workspace) => ({ ...workspace, kind: "scratch" })),
    });
    expect(tabs().workspaces.map((workspace) => workspace.kind)).toEqual(["local"]);
  });
});
