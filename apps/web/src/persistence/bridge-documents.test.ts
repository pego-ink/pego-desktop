/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { emptySession } from "@/agent/sessions/session-model";
import { setVisibleStatus } from "@/agent/test-utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { captureLive, documentTitle } from "@/workspace/live-document";
import { resetLiveDocument } from "@/workspace/test-reset";
import {
  listTabsForBridge,
  loadDocumentFromBridge,
  markSavedFromBridge,
  openDocumentText,
  snapshotDocumentForBridge,
  switchTabForBridge,
} from "./bridge-documents";
import { serializeDocument } from "./file-format";
import { getIsDirty, useFileStore } from "./use-file-store";

const pegoText = serializeDocument({ ...sampleDoc, name: "From disk" });

beforeEach(() => {
  resetLiveDocument();
  // Start from one fresh chat session: other suites may leave a run "active" (which blocks
  // opening tabs) or a visible session id with no live entry (so a run here would not count).
  useAgentStore.getState().resetSessions(emptySession());
  setVisibleStatus("idle");
});

/** Title of the shown document, in a list like the editor's list_documents reply. */
const titles = () => {
  const live = captureLive();
  return [documentTitle(live.doc, live.file)];
};

describe("bridge documents", () => {
  test("opens a .pego file as saved, remembering its path", () => {
    const outcome = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/app.pego" });
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toStartWith("Opened /repo/design/app.pego");
    expect(useDocumentStore.getState().doc.name).toBe("From disk");
    expect(useFileStore.getState()).toMatchObject({
      fileName: "app.pego",
      bridgePath: "/repo/design/app.pego",
    });
    expect(getIsDirty()).toBe(false);
    expect(titles()).toEqual(["app.pego"]);
  });

  test("another file opens in its own tab; unsaved work stays in its tab", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 5 } }]);
    const opened = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/b.pego" });
    expect(opened.isError).toBe(false);
    expect(titles()).toEqual(["b.pego"]);
    const listed = JSON.parse(listTabsForBridge().content) as {
      tabs: { path: string; dirty: boolean; active: boolean }[];
    };
    expect(listed.tabs).toEqual([
      expect.objectContaining({ path: "/repo/design/a.pego", dirty: true, active: false }),
      expect.objectContaining({ path: "/repo/design/b.pego", dirty: false, active: true }),
    ]);
    expect(switchTabForBridge({ path: "/repo/design/a.pego" }).isError).toBe(false);
    expect(getIsDirty()).toBe(true);
  });

  test("replacing the shown document refuses unsaved work unless told to drop it", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 5 } }]);
    const replace = (discardUnsaved: boolean) =>
      openDocumentText(pegoText, "/repo/design/b.pego", {
        unsaved: "refuse",
        discardUnsaved,
        place: "replace",
      });
    const refused = replace(false);
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain("has unsaved changes. Call save_document first");
    expect(useFileStore.getState().bridgePath).toBe("/repo/design/a.pego");
    expect(replace(true).isError).toBe(false);
    expect(titles()).toEqual(["b.pego"]);
  });

  test("a file a run is editing is not reloaded under it", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    setVisibleStatus("running");
    const busy = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    expect(busy.content).toContain("busy with an agent run");
    setVisibleStatus("idle");
  });

  test("the shown file is reloaded when clean, kept when it has unsaved changes", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    const again = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    expect(again.content).toStartWith("Reloaded /repo/design/a.pego");
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 9 } }]);
    const kept = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    expect(kept.content).toContain("unsaved changes; keeping them");
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

  test("list and switch for the MCP tools", () => {
    loadDocumentFromBridge({ text: pegoText, path: "/repo/design/a.pego" });
    const listed = JSON.parse(listTabsForBridge().content) as {
      tabs: { path: string; active: boolean }[];
    };
    expect(listed.tabs.map((tab) => [tab.path, tab.active])).toEqual([
      ["/repo/design/a.pego", true],
    ]);
    expect(switchTabForBridge({ path: "/repo/design/a.pego" }).isError).toBe(false);
    expect(switchTabForBridge({ path: "/nope.pego" }).content).toStartWith("not_open");
  });

  test("a project's design takes the project id, as a change the next save writes", () => {
    const path = "/repo/design/shop/project.pego";
    expect(openDocumentText(pegoText, path, { documentId: "shp00001" }).isError).toBe(false);
    expect(useDocumentStore.getState().doc.id).toBe("shp00001");
    expect(getIsDirty()).toBe(true);
    // A design that already carries the project id opens clean.
    resetLiveDocument();
    const own = serializeDocument({ ...sampleDoc, id: "shp00001" });
    openDocumentText(own, path, { documentId: "shp00001" });
    expect(getIsDirty()).toBe(false);
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
