/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { useAgentStore } from "@/agent/use-agent-store";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { resetTabs } from "./test-reset";
import {
  captureLive,
  closeTab,
  newTab,
  openTab,
  restoreTabs,
  switchTab,
  tabIsDirty,
  tabTitle,
  useTabsStore,
} from "./use-tabs-store";

const docs = () => useDocumentStore.getState();
const tabs = () => useTabsStore.getState().tabs;
const named = (name: string) => ({ ...sampleDoc, name });
const confirmAnswers: boolean[] = [];
const originalConfirm = globalThis.window?.confirm;

beforeEach(() => {
  resetTabs();
  useAgentStore.getState().set({ status: "idle" });
  (globalThis as { window?: unknown }).window ??= {};
  (globalThis.window as { confirm: () => boolean }).confirm = () => confirmAnswers.shift() ?? true;
});
afterEach(() => {
  if (originalConfirm) window.confirm = originalConfirm;
});

describe("tabs", () => {
  test("each tab keeps its own document, undo history and selection", () => {
    openTab(named("A"), { fileName: "a.pego" });
    docs().commit([{ op: "update", id: "frame-1", props: { x: 10 } }]);
    docs().select(["frame-1"]);
    newTab();
    expect(tabs()).toHaveLength(2);
    expect(docs().history.past).toHaveLength(0);

    switchTab(tabs()[0]!.id);
    expect(docs().doc.name).toBe("A");
    expect(docs().selection).toEqual(["frame-1"]);
    docs().undo();
    expect(docs().doc.children[0]!.children[0]).toMatchObject({ x: 0 });
  });

  test("the untouched untitled tab is reused by the first opened file", () => {
    openTab(named("A"), { fileName: "a.pego" });
    expect(tabs().map(tabTitle)).toEqual(["a.pego"]);
  });

  test("closing asks for unsaved tabs and falls back to a new document", () => {
    openTab(named("A"), { fileName: "a.pego" }, { saved: false });
    expect(tabIsDirty(tabs()[0]!)).toBe(true);
    confirmAnswers.push(false);
    closeTab(tabs()[0]!.id);
    expect(tabs()).toHaveLength(1);
    expect(docs().doc.name).toBe("A");
    confirmAnswers.push(true);
    closeTab(tabs()[0]!.id);
    expect(tabs()).toHaveLength(1);
    expect(tabTitle(tabs()[0]!)).toBe("Untitled");
    expect(docs().doc.name).toBe("Untitled");
  });

  test("closing the active tab shows its neighbor", () => {
    openTab(named("A"), { fileName: "a.pego" });
    openTab(named("B"), { fileName: "b.pego" });
    closeTab(useTabsStore.getState().activeId);
    expect(tabs().map(tabTitle)).toEqual(["a.pego"]);
    expect(docs().doc.name).toBe("A");
  });

  test("switching is blocked while the panel agent runs", () => {
    openTab(named("A"), { fileName: "a.pego" });
    openTab(named("B"), { fileName: "b.pego" });
    useAgentStore.getState().set({ status: "running" });
    expect(switchTab(tabs()[0]!.id)).toBe(false);
    expect(docs().doc.name).toBe("B");
  });

  test("restoreTabs rebuilds every tab with the given one active", () => {
    const a = {
      ...captureLive(),
      doc: named("A"),
      file: { ...captureLive().file, fileName: "a.pego" },
    };
    const b = {
      ...captureLive(),
      doc: named("B"),
      file: { ...captureLive().file, fileName: "b.pego" },
    };
    restoreTabs([a, b], 1);
    expect(tabs().map(tabTitle)).toEqual(["a.pego", "b.pego"]);
    expect(docs().doc.name).toBe("B");
    expect(useFileStore.getState().fileName).toBe("b.pego");
  });
});
