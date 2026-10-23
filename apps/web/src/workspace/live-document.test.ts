/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { emptySession } from "@/agent/sessions/session-model";
import { setVisibleStatus } from "@/agent/test-utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { captureLive, documentTitle, isProjectDesign } from "./live-document";
import { releaseWindow, resetLiveDocument, stubConfirm } from "./test-reset";
import { openDocument, openNewDocument, useWorkspaceStore } from "./use-workspace-store";

const docs = () => useDocumentStore.getState();
const named = (name: string) => ({ ...sampleDoc, name });
let confirmAnswer = true;
let asked = 0;

beforeEach(() => {
  resetLiveDocument();
  // Start from one fresh chat session: other suites may leave a visible session id with no live
  // entry, and then setVisibleStatus("running") would not count as a run.
  useAgentStore.getState().resetSessions(emptySession());
  setVisibleStatus("idle");
  confirmAnswer = true;
  asked = 0;
  stubConfirm(() => {
    asked++;
    return confirmAnswer;
  });
});

afterAll(releaseWindow);

const edit = () => docs().commit([{ op: "update", id: "frame-1", props: { x: 10 } }]);

const tabCount = () => useWorkspaceStore.getState().workspaces.length;

describe("one document per tab", () => {
  test("opening a file adds a tab; an untouched untitled tab is reused", () => {
    // The starting tab is untitled and untouched: the first file takes its place.
    openDocument(named("A"), { fileName: "a.pego" });
    expect(tabCount()).toBe(1);
    openDocument(named("B"), { fileName: "b.pego" });
    expect(tabCount()).toBe(2);
    expect(docs().doc.name).toBe("B");
    expect(useFileStore.getState().fileName).toBe("b.pego");
    expect(asked).toBe(0);
  });

  test("replacing the shown document: ask (user), refuse (Claude Code), discard", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    edit();
    confirmAnswer = false;
    const replace = (unsaved: "ask" | "refuse" | "discard") =>
      openDocument(named("B"), {}, { unsaved, place: "replace" });
    expect(replace("ask")).toBe("unsaved");
    expect(docs().doc.name).toBe("A");
    expect(replace("refuse")).toBe("unsaved");
    expect(asked).toBe(1);
    expect(replace("discard")).toBe("opened");
    expect(docs().doc.name).toBe("B");
    expect(tabCount()).toBe(1);
  });

  test("new documents start clean and untitled, in their own tab", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    expect(openNewDocument()).toBe("opened");
    expect(tabCount()).toBe(2);
    expect(docs().doc.name).toBe("Untitled");
    const live = captureLive();
    expect(documentTitle(live.doc, live.file)).toBe("Untitled");
    expect(live.file.savedDoc).toBe(live.doc);
  });

  test("a run working in the shown tab blocks replacing its document, not opening a tab", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    setVisibleStatus("running");
    expect(openDocument(named("B"), {}, { place: "replace" })).toBe("busy");
    expect(openDocument(named("B"), {})).toBe("opened");
    expect(tabCount()).toBe(2);
    setVisibleStatus("idle");
  });
});

describe("titles", () => {
  test("a project's design shows the project name; other files their file name", () => {
    const doc = { ...sampleDoc, name: "Web Hotel" };
    expect(
      documentTitle(doc, {
        fileName: "project.pego",
        bridgePath: "/r/design/web-hotel/project.pego",
      }),
    ).toBe("Web Hotel");
    expect(
      documentTitle(doc, { fileName: "rooms.pego", bridgePath: "/r/design/web-hotel/rooms.pego" }),
    ).toBe("rooms.pego");
    expect(documentTitle(doc, { fileName: null, bridgePath: null })).toBe("Untitled");
    expect(isProjectDesign("C:\\design\\shop\\project.pego")).toBe(true);
  });
});
