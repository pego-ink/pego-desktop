/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { setVisibleStatus } from "@/agent/test-utils";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import {
  captureLive,
  documentTitle,
  isProjectDesign,
  openDocument,
  openNewDocument,
} from "./live-document";
import { releaseWindow, resetLiveDocument, stubConfirm } from "./test-reset";

const docs = () => useDocumentStore.getState();
const named = (name: string) => ({ ...sampleDoc, name });
let confirmAnswer = true;
let asked = 0;

beforeEach(() => {
  resetLiveDocument();
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

describe("one document per workspace", () => {
  test("opening replaces the shown document", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    openDocument(named("B"), { fileName: "b.pego" });
    expect(docs().doc.name).toBe("B");
    expect(useFileStore.getState().fileName).toBe("b.pego");
    expect(asked).toBe(0);
  });

  test("unsaved changes: ask (user), refuse (Claude Code), discard", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    edit();
    confirmAnswer = false;
    expect(openDocument(named("B"), {}, { unsaved: "ask" })).toBe("unsaved");
    expect(docs().doc.name).toBe("A");
    expect(openDocument(named("B"), {}, { unsaved: "refuse" })).toBe("unsaved");
    expect(asked).toBe(1);
    expect(openDocument(named("B"), {}, { unsaved: "discard" })).toBe("opened");
    expect(docs().doc.name).toBe("B");
  });

  test("new documents start clean and untitled", () => {
    openDocument(named("A"), { fileName: "a.pego" });
    expect(openNewDocument()).toBe("opened");
    expect(docs().doc.name).toBe("Untitled");
    const live = captureLive();
    expect(documentTitle(live.doc, live.file)).toBe("Untitled");
    expect(live.file.savedDoc).toBe(live.doc);
  });

  test("opening is blocked while the panel agent runs", () => {
    setVisibleStatus("running");
    expect(openDocument(named("A"), {})).toBe("busy");
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
