/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadIconData } from "@/canvas/icons";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { focusCamera, unionBoxes } from "./focus-camera";
import { resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";

beforeAll(loadIconData);
beforeEach(() => {
  resetStores();
  useViewportStore.setState({ size: { width: 1000, height: 800 } });
});

describe("selection", () => {
  test("setSelection stores known ids and ignores unknown ones", () => {
    const host = createToolHost();
    host.setSelection?.(["frame-1", "nope", "frame-1"]);
    expect(host.getSelection?.()).toEqual(["frame-1"]);
    expect(useDocumentStore.getState().selection).toEqual(["frame-1"]);
    host.setSelection?.([]);
    expect(host.getSelection?.()).toEqual([]);
  });
});

describe("getLayout / listIcons", () => {
  test("getLayout returns the boxes of the current document", () => {
    const host = createToolHost();
    expect(host.getLayout?.().get("frame-1")?.width).toBeGreaterThan(0);
  });

  test("listIcons returns kebab-case lucide names", () => {
    const icons = createToolHost().listIcons?.() ?? [];
    expect(icons.length).toBeGreaterThan(100);
    expect(icons).toContain("arrow-right");
    expect(icons.every((name) => name === name.toLowerCase() && !name.includes("_"))).toBe(true);
  });
});

describe("focusViewport", () => {
  test("centers a node and moves the camera", () => {
    const host = createToolHost();
    const box = host.getLayout?.().get("frame-1");
    host.focusViewport?.(["frame-1"]);
    const { camera } = useViewportStore.getState();
    expect(camera.zoom).toBeLessThanOrEqual(1);
    if (!box) throw new Error("missing layout");
    const centerX = (box.x + box.width / 2) * camera.zoom + camera.panX;
    expect(centerX).toBeCloseTo(500, 3);
  });

  test("unknown ids and a zero-size viewport leave the camera alone", () => {
    const host = createToolHost();
    const before = useViewportStore.getState().camera;
    host.focusViewport?.(["nope"]);
    expect(useViewportStore.getState().camera).toBe(before);
    useViewportStore.setState({ size: { width: 0, height: 0 } });
    host.focusViewport?.(["frame-1"]);
    expect(useViewportStore.getState().camera).toBe(before);
  });
});

describe("focusCamera", () => {
  const viewport = { width: 1000, height: 800 };

  test("small boxes are centered at zoom 1, not blown up", () => {
    const camera = focusCamera([{ x: 100, y: 100, width: 50, height: 50 }], viewport);
    expect(camera).toEqual({ zoom: 1, panX: 500 - 125, panY: 400 - 125 });
  });

  test("large boxes zoom out to fit with padding", () => {
    const camera = focusCamera([{ x: 0, y: 0, width: 4000, height: 1000 }], viewport, {
      padding: 50,
    });
    expect(camera?.zoom).toBeCloseTo(900 / 4000, 6);
  });

  test("unions several boxes", () => {
    expect(
      unionBoxes([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 30, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(focusCamera([], viewport)).toBeNull();
  });
});
