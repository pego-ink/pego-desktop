/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { setVisibleStatus } from "@/agent/test-utils";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { captureLive, documentTitle, openDocument } from "./live-document";
import { releaseWindow, resetLiveDocument, stubConfirm } from "./test-reset";
import {
  activateWorkspace,
  closeWorkspace,
  liveProject,
  openProjectWorkspace,
  SCRATCH_ID,
  showDashboard,
  useWorkspaceStore,
  workspaceIsDirty,
} from "./use-workspace-store";

const checkout = { id: "chk00001", name: "Checkout", dir: "/repo/design/checkout" };
const shop = { id: "shp00001", name: "Shop", dir: "/repo/design/shop" };
const title = () => {
  const live = captureLive();
  return documentTitle(live.doc, live.file);
};

beforeEach(() => {
  resetLiveDocument();
  setVisibleStatus("idle");
  useWorkspaceStore.setState({
    workspaces: [{ id: SCRATCH_ID, name: "Scratch", dir: null, kind: "scratch", saved: null }],
    liveId: SCRATCH_ID,
    view: "dashboard",
  });
  stubConfirm(() => true);
});

afterAll(releaseWindow);

describe("workspaces", () => {
  test("opening a project gives it its own document; switching back restores scratch", () => {
    openDocument({ ...sampleDoc, name: "Scratch doc" }, { fileName: "notes.pego" });
    openProjectWorkspace(checkout);
    expect(useWorkspaceStore.getState()).toMatchObject({ liveId: "chk00001", view: "editor" });
    expect(liveProject()?.name).toBe("Checkout");
    expect(title()).toBe("Untitled");
    openDocument(
      { ...sampleDoc, name: "Pay" },
      { fileName: "pay.pego", bridgePath: "/repo/design/checkout/pay.pego" },
    );

    activateWorkspace(SCRATCH_ID);
    expect(title()).toBe("notes.pego");
    expect(useDocumentStore.getState().doc.name).toBe("Scratch doc");
    expect(liveProject()).toBeNull();

    openProjectWorkspace(checkout);
    expect(title()).toBe("pay.pego");
    expect(useFileStore.getState().bridgePath).toBe("/repo/design/checkout/pay.pego");
  });

  test("each project keeps its own documents", () => {
    openProjectWorkspace(checkout);
    openDocument({ ...sampleDoc, name: "Pay" }, { fileName: "pay.pego" });
    openProjectWorkspace(shop);
    openDocument({ ...sampleDoc, name: "Home" }, { fileName: "home.pego" });
    openProjectWorkspace(checkout);
    expect(useDocumentStore.getState().doc.name).toBe("Pay");
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.name)).toEqual([
      "Scratch",
      "Checkout",
      "Shop",
    ]);
  });

  test("the dashboard is a view: the live project stays loaded", () => {
    openProjectWorkspace(checkout);
    showDashboard();
    expect(useWorkspaceStore.getState()).toMatchObject({ view: "dashboard", liveId: "chk00001" });
    activateWorkspace("chk00001");
    expect(useWorkspaceStore.getState().view).toBe("editor");
  });

  test("closing a project with unsaved work asks; the live one falls back to scratch", () => {
    openProjectWorkspace(checkout);
    openDocument({ ...sampleDoc, name: "Pay" }, { fileName: "pay.pego" }, { saved: false });
    const workspace = useWorkspaceStore.getState().workspaces[1]!;
    expect(workspaceIsDirty(workspace)).toBe(true);
    stubConfirm(() => false);
    closeWorkspace("chk00001");
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    stubConfirm(() => true);
    closeWorkspace("chk00001");
    expect(useWorkspaceStore.getState()).toMatchObject({ liveId: SCRATCH_ID, view: "dashboard" });
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual([SCRATCH_ID]);
  });

  test("switching projects is blocked during a panel agent run", () => {
    openProjectWorkspace(checkout);
    setVisibleStatus("running");
    expect(openProjectWorkspace(shop)).toBe(false);
    expect(useWorkspaceStore.getState().liveId).toBe("chk00001");
  });
});
