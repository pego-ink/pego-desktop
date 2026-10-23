/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { PegoDocument, PegoNode } from "@pego/doc";
import { exportTargets, projectSlug } from "./project-export";

const frame = (id: string, name?: string, extra: Partial<PegoNode> = {}) =>
  ({ type: "frame", id, name, layout: "none", children: [], ...extra }) as PegoNode;

const doc = {
  version: 5,
  id: "proj",
  name: "Ayam Den Lapeh",
  variables: {},
  children: [
    {
      type: "page",
      id: "p1",
      name: "Main flow",
      children: [
        frame("a", "Landing"),
        frame("b", "Landing"),
        frame("c", "Hidden", { visible: false }),
        { type: "rectangle", id: "loose", x: 0, y: 0, width: 10, height: 10 } as PegoNode,
        { type: "ref", id: "inst", ref: "a", name: "Login screen" } as PegoNode,
      ],
    },
    { type: "page", id: "p2", name: "Main flow", children: [frame("d")] },
    { type: "page", id: "p3", name: "Empty", children: [] },
    {
      type: "page",
      id: "lib",
      name: "Library · Kit",
      library: { projectId: "kit", name: "Kit", path: "kit/project.pego", syncedAt: "x" },
      children: [frame("e", "Button")],
    },
  ],
} as unknown as PegoDocument;

describe("project export", () => {
  test("every visible top-level frame or instance, a folder per page, unique names", () => {
    expect(exportTargets(doc)).toEqual([
      { id: "a", folder: "main-flow", name: "landing" },
      { id: "b", folder: "main-flow", name: "landing-2" },
      { id: "inst", folder: "main-flow", name: "login-screen" },
      { id: "d", folder: "main-flow-2", name: "frame" },
    ]);
  });

  test("library pages, hidden frames, loose shapes and empty pages are left out", () => {
    const ids = exportTargets(doc).map((target) => target.id);
    expect(ids).not.toContain("e");
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("loose");
  });

  test("the download is named after the project", () => {
    expect(projectSlug({ name: "Ayam Den Lapeh" })).toBe("ayam-den-lapeh");
    expect(projectSlug({ name: "  " })).toBe("project");
  });
});
