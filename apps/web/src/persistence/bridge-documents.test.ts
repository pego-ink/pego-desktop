/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import {
  loadDocumentFromBridge,
  markSavedFromBridge,
  snapshotDocumentForBridge,
} from "./bridge-documents";
import { serializeDocument } from "./file-format";
import { getIsDirty, useFileStore } from "./use-file-store";

const pegoText = serializeDocument({ ...sampleDoc, name: "From disk" });

beforeEach(() => {
  useDocumentStore.getState().load(sampleDoc);
  useFileStore.getState().markSaved(useDocumentStore.getState().doc, null, null);
});

describe("bridge documents", () => {
  test("loads a .pego file as saved, remembering its path", () => {
    const outcome = loadDocumentFromBridge({ text: pegoText, path: "/repo/design/app.pego" });
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toStartWith("Opened /repo/design/app.pego");
    expect(useDocumentStore.getState().doc.name).toBe("From disk");
    expect(useFileStore.getState()).toMatchObject({
      fileName: "app.pego",
      bridgePath: "/repo/design/app.pego",
    });
    expect(getIsDirty()).toBe(false);
  });

  test("refuses to replace unsaved work unless told to", () => {
    useFileStore.getState().setSession({ fileName: "mine.pego", handle: null, savedDoc: null });
    const refused = loadDocumentFromBridge({ text: pegoText, path: "/repo/app.pego" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content).toContain('"mine.pego" has unsaved changes');
    expect(
      loadDocumentFromBridge({ text: pegoText, path: "/repo/app.pego", discardUnsaved: true })
        .isError,
    ).toBe(false);
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
