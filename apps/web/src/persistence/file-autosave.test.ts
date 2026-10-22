/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setVisibleStatus } from "@/agent/test-utils";
import { useDocumentStore } from "@/store/use-document-store";
import { resetLiveDocument } from "@/workspace/test-reset";
import {
  openProjectWorkspace,
  SCRATCH_ID,
  useWorkspaceStore,
  workspaceIsDirty,
} from "@/workspace/use-workspace-store";
import { startFileAutosave } from "./file-autosave";
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

describe("file autosave across workspaces", () => {
  test("a pending write of the outgoing document lands before another workspace is shown", async () => {
    const writes: string[] = [];
    useFileStore.setState({
      fileName: "a.pego",
      handle: fakeHandle(writes),
      savedDoc: useDocumentStore.getState().doc,
    });
    stop = startFileAutosave();
    await settle();
    useDocumentStore.getState().commit([{ op: "update", id: "frame-1", props: { x: 42 } }]);
    // The debounce is armed (1.5s); switching now must not drop the change.
    openProjectWorkspace({ id: "shp00001", name: "Shop", dir: "/repo/design/shop" });
    await settle();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"x": 42');
    const scratch = useWorkspaceStore.getState().workspaces.find((w) => w.id === SCRATCH_ID)!;
    expect(workspaceIsDirty(scratch)).toBe(false);
  });
});
