/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc, type Layout } from "@pego/doc";
import { buildAppState, type AppStateInput } from "./app-state";

const input = (patch: Partial<AppStateInput> = {}): AppStateInput => ({
  doc: sampleDoc,
  pageId: null,
  selection: [],
  file: { fileName: null, bridgePath: null },
  layout: new Map([["frame-1", { x: 0, y: 0, width: 800, height: 600 }]]) as Layout,
  camera: { panX: 0, panY: 0, zoom: 1 },
  viewport: { width: 1000, height: 800 },
  browser: null,
  ...patch,
});

describe("buildAppState", () => {
  test("document, page, selection and the top-level layers with their visibility", () => {
    const state = buildAppState(input({ selection: ["text-1", "gone"] }));
    expect(state.document).toEqual({ name: "Untitled", file: null, page: "Page 1" });
    expect(state.selection).toEqual([{ id: "text-1", name: "Title", type: "text" }]);
    expect(state.topLevel).toEqual([{ id: "frame-1", name: "Frame", type: "frame", inView: true }]);
  });

  test("a layer the camera moved away from is outside the view; no viewport means none in view", () => {
    const away = buildAppState(input({ camera: { panX: -5000, panY: 0, zoom: 1 } }));
    expect(away.topLevel[0]?.inView).toBe(false);
    const sizeless = buildAppState(input({ viewport: { width: 0, height: 0 } }));
    expect(sizeless.topLevel[0]?.inView).toBe(false);
  });

  test("components come from every page", () => {
    const page = sampleDoc.children[0]!;
    const doc = {
      ...sampleDoc,
      children: [
        page,
        {
          type: "page" as const,
          id: "p2",
          name: "Kit",
          x: 0,
          y: 0,
          children: [
            { type: "rectangle" as const, id: "btn", name: "Button", x: 0, y: 0, reusable: true },
          ],
        },
      ],
    };
    expect(buildAppState(input({ doc })).components).toEqual([
      { id: "btn", name: "Button", type: "rectangle" },
    ]);
  });
});
