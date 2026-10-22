/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useAgentStore } from "@/agent/use-agent-store";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { releaseWindow, resetTabs, stubConfirm } from "./test-reset";
import {
  documentTitle,
  isProjectDesign,
  newTab,
  openTab,
  tabTitle,
  useTabsStore,
} from "./use-tabs-store";

const docs = () => useDocumentStore.getState();
const named = (name: string) => ({ ...sampleDoc, name });
let confirmAnswer = true;
let asked = 0;

beforeEach(() => {
  resetTabs();
  useAgentStore.getState().set({ status: "idle" });
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
  test("opening replaces the shown document; there is never more than one tab", () => {
    openTab(named("A"), { fileName: "a.pego" });
    openTab(named("B"), { fileName: "b.pego" });
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(docs().doc.name).toBe("B");
    expect(useFileStore.getState().fileName).toBe("b.pego");
    expect(asked).toBe(0);
  });

  test("unsaved changes: ask (user), refuse (Claude Code), discard", () => {
    openTab(named("A"), { fileName: "a.pego" });
    edit();
    confirmAnswer = false;
    expect(openTab(named("B"), {}, { unsaved: "ask" })).toBe("unsaved");
    expect(docs().doc.name).toBe("A");
    expect(openTab(named("B"), {}, { unsaved: "refuse" })).toBe("unsaved");
    expect(asked).toBe(1);
    expect(openTab(named("B"), {}, { unsaved: "discard" })).toBe("opened");
    expect(docs().doc.name).toBe("B");
  });

  test("new documents start clean and untitled", () => {
    openTab(named("A"), { fileName: "a.pego" });
    expect(newTab()).toBe("opened");
    expect(docs().doc.name).toBe("Untitled");
    expect(tabTitle(useTabsStore.getState().tabs[0]!)).toBe("Untitled");
  });

  test("opening is blocked while the panel agent runs", () => {
    useAgentStore.getState().set({ status: "running" });
    expect(openTab(named("A"), {})).toBe("busy");
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
