/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { useAgentStore } from "@/agent/use-agent-store";
import { resetTabs } from "@/tabs/test-reset";
import { tabIsDirty, tabTitle, useTabsStore } from "@/tabs/use-tabs-store";
import {
  listTabsForBridge,
  loadDocumentFromBridge,
  markSavedFromBridge,
  snapshotDocumentForBridge,
  switchTabForBridge,
} from "./bridge-documents";
import { serializeDocument } from "./file-format";
import { getIsDirty, useFileStore } from "./use-file-store";

const pegoText = serializeDocument({ ...sampleDoc, name: "From disk" });

beforeEach(() => {
  resetTabs();
  // Other suites leave a run "active", which blocks opening tabs.
  useAgentStore.getState().set({ status: "idle" });
});

const titles = () => useTabsStore.getState().tabs.map(tabTitle);

describe("bridge documents", () => {
  test("opens a .pego file as saved, remembering its path (reusing the untouched tab)", () => {
    const outcome = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/app.pego" });
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toStartWith("Opened /repo/design/app.pego in a tab");
    expect(useDocumentStore.getState().doc.name).toBe("From disk");
    expect(useFileStore.getState()).toMatchObject({
      fileName: "app.pego",
      bridgePath: "/repo/design/app.pego",
    });
    expect(getIsDirty()).toBe(false);
    expect(titles()).toEqual(["app.pego"]);
  });

  test("a second file opens in a new tab; the first keeps its unsaved work", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 5 } }]);
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/b.pego" });
    expect(titles()).toEqual(["a.pego", "b.pego"]);
    const first = useTabsStore.getState().tabs[0]!;
    expect(tabIsDirty(first)).toBe(true);
  });

  test("an open file is shown again: reloaded when clean, kept when it has unsaved changes", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/b.pego" });
    const again = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    expect(again.content).toStartWith("Reloaded /repo/design/a.pego");
    expect(titles()).toEqual(["a.pego", "b.pego"]);
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 9 } }]);
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/b.pego" });
    const kept = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    expect(kept.content).toContain("unsaved changes");
    expect(getIsDirty()).toBe(true);
  });

  test("imports .pen as unsaved, saving next to it as .pego", () => {
    const pen = JSON.stringify({
      version: "2.21",
      children: [{ type: "frame", id: "f", name: "Home" }],
    });
    const outcome = loadDocumentFromBridge({ text: pen, path: "/repo/old.pen" });
    expect(outcome.content).toContain("save_document writes /repo/old.pego");
    expect(useFileStore.getState()).toMatchObject({
      fileName: "old.pego",
      bridgePath: "/repo/old.pego",
    });
    expect(getIsDirty()).toBe(true);
  });

  test("list and switch tabs for the MCP tools", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/b.pego" });
    const listed = JSON.parse(listTabsForBridge().content) as {
      tabs: { path: string; active: boolean }[];
    };
    expect(listed.tabs.map((tab) => [tab.path, tab.active])).toEqual([
      ["/repo/design/a.pego", false],
      ["/repo/design/b.pego", true],
    ]);
    expect(switchTabForBridge({ path: "/repo/design/a.pego" }).isError).toBe(false);
    expect(useFileStore.getState().bridgePath).toBe("/repo/design/a.pego");
    expect(switchTabForBridge({ path: "/nope.pego" }).content).toStartWith("not_open");
  });

  test("reports parse errors", () => {
    expect(loadDocumentFromBridge({ text: "{nope", path: "/repo/x.pego" })).toMatchObject({
      isError: true,
    });
  });

  test("snapshot then mark_saved records exactly the snapshot", () => {
    useFileStore.getState().setSession({ fileName: null, handle: null, savedDoc: null });
    const snapshot = JSON.parse(snapshotDocumentForBridge().content) as {
      text: string;
      snapshotId: string;
    };
    expect(snapshot.text).toBe(serializeDocument(useDocumentStore.getState().doc));
    expect(markSavedFromBridge({ snapshotId: "other", path: "/repo/a.pego" }).isError).toBe(true);
    expect(
      markSavedFromBridge({ snapshotId: snapshot.snapshotId, path: "/repo/a.pego" }).isError,
    ).toBe(false);
    expect(useFileStore.getState()).toMatchObject({
      fileName: "a.pego",
      bridgePath: "/repo/a.pego",
    });
    expect(getIsDirty()).toBe(false);
  });
});
