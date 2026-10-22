/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setVisibleStatus } from "@/agent/test-utils";
import { useDocumentStore } from "@/store/use-document-store";
import { commitToTarget, visibleTarget } from "@/workspace/document-target";
import { resetLiveDocument, TEST_TAB_ID } from "@/workspace/test-reset";
import {
  findWorkspace,
  newDocumentTab,
  openProjectWorkspace,
  workspaceIsDirty,
} from "@/workspace/use-workspace-store";
import { flushFileAutosaves, startFileAutosave } from "./file-autosave";
import type { PegoFileHandle } from "./fs-access";
import { useAutosaveStore } from "./use-autosave-store";
import { useFileStore } from "./use-file-store";

const fakeHandle = (writes: string[]): PegoFileHandle => ({
  name: "a.pego",
  getFile: async () => new File([], "a.pego"),
  createWritable: async () => {
    let text = "";
    return {
      write: async (data) => {
        text += String(data);
      },
      close: async () => {
        writes.push(text);
      },
    };
  },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let stop: () => void = () => {};
let createdWindow = false;

beforeEach(() => {
  // File autosave needs the File System Access API to count as supported.
  const scope = globalThis as unknown as { window?: Record<string, unknown> };
  if (!scope.window) {
    scope.window = {};
    createdWindow = true;
  }
  scope.window.showSaveFilePicker = () => undefined;
  // Reduced motion: camera moves jump instead of animating.
  scope.window.matchMedia ??= () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  resetLiveDocument();
  setVisibleStatus("idle");
  useAutosaveStore.setState({ enabled: true, status: "idle" });
});

afterEach(() => {
  stop();
  const scope = globalThis as unknown as { window?: Record<string, unknown> };
  if (createdWindow) delete scope.window;
  else delete scope.window?.showSaveFilePicker;
  // (matchMedia stays: the motion module caches the query it returned.)
  createdWindow = false;
});

describe("file autosave across tabs", () => {
  const openLocalFile = (writes: string[]) =>
    useFileStore.setState({
      fileName: "a.pego",
      handle: fakeHandle(writes),
      savedDoc: useDocumentStore.getState().doc,
    });

  test("a pending write of a tab that was switched away still lands, to its own file", async () => {
    const writes: string[] = [];
    openLocalFile(writes);
    stop = startFileAutosave();
    await settle();
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 42 } }]);
    // The debounce is armed (1.5s); switching now must not drop the change.
    openProjectWorkspace({ id: "shp00001", name: "Shop", dir: "/repo/design/shop" });
    await flushFileAutosaves();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"x": 42');
    expect(workspaceIsDirty(findWorkspace(TEST_TAB_ID)!)).toBe(false);
  });

  test("a background document edited by a run is saved and marked clean", async () => {
    const writes: string[] = [];
    openLocalFile(writes);
    stop = startFileAutosave();
    await settle();
    const target = visibleTarget()!;
    newDocumentTab();
    expect(
      commitToTarget(target, [{ op: "update", id: "frame-1", props: { x: 64 } }], {
        source: "agent",
        runId: "run-bg",
      }),
    ).toBe(true);
    expect(workspaceIsDirty(findWorkspace(TEST_TAB_ID)!)).toBe(true);
    await flushFileAutosaves();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"x": 64');
    expect(workspaceIsDirty(findWorkspace(TEST_TAB_ID)!)).toBe(false);
  });
});
