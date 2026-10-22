/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useAgentStore } from "@/agent/use-agent-store";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { resetTabs } from "@/tabs/test-reset";
import { openTab, tabTitle, useTabsStore } from "@/tabs/use-tabs-store";
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
const titles = () => useTabsStore.getState().tabs.map(tabTitle);

beforeEach(() => {
  resetTabs();
  useAgentStore.getState().set({ status: "idle" });
  useWorkspaceStore.setState({
    workspaces: [{ id: SCRATCH_ID, name: "Scratch", dir: null, kind: "scratch", saved: null }],
    liveId: SCRATCH_ID,
    view: "dashboard",
  });
  (globalThis as { window?: unknown }).window ??= {};
  (globalThis.window as { confirm: () => boolean }).confirm = () => true;
});

describe("workspaces", () => {
  test("opening a project gives it its own document tabs; switching back restores scratch", () => {
    openTab({ ...sampleDoc, name: "Scratch doc" }, { fileName: "notes.pego" });
    openProjectWorkspace(checkout);
    expect(useWorkspaceStore.getState()).toMatchObject({ liveId: "chk00001", view: "editor" });
    expect(liveProject()?.name).toBe("Checkout");
    expect(titles()).toEqual(["Untitled"]);
    openTab(
      { ...sampleDoc, name: "Pay" },
      { fileName: "pay.pego", bridgePath: "/repo/design/checkout/pay.pego" },
    );

    activateWorkspace(SCRATCH_ID);
    expect(titles()).toEqual(["notes.pego"]);
    expect(useDocumentStore.getState().doc.name).toBe("Scratch doc");
    expect(liveProject()).toBeNull();

    openProjectWorkspace(checkout);
    expect(titles()).toEqual(["pay.pego"]);
    expect(useFileStore.getState().bridgePath).toBe("/repo/design/checkout/pay.pego");
  });

  test("each project keeps its own documents", () => {
    openProjectWorkspace(checkout);
    openTab({ ...sampleDoc, name: "Pay" }, { fileName: "pay.pego" });
    openProjectWorkspace(shop);
    openTab({ ...sampleDoc, name: "Home" }, { fileName: "home.pego" });
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
    openTab({ ...sampleDoc, name: "Pay" }, { fileName: "pay.pego" }, { saved: false });
    const workspace = useWorkspaceStore.getState().workspaces[1]!;
    expect(workspaceIsDirty(workspace)).toBe(true);
    (globalThis.window as { confirm: () => boolean }).confirm = () => false;
    closeWorkspace("chk00001");
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    (globalThis.window as { confirm: () => boolean }).confirm = () => true;
    closeWorkspace("chk00001");
    expect(useWorkspaceStore.getState()).toMatchObject({ liveId: SCRATCH_ID, view: "dashboard" });
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual([SCRATCH_ID]);
  });

  test("switching projects is blocked during a panel agent run", () => {
    openProjectWorkspace(checkout);
    useAgentStore.getState().set({ status: "running" });
    expect(openProjectWorkspace(shop)).toBe(false);
    expect(useWorkspaceStore.getState().liveId).toBe("chk00001");
  });
});
