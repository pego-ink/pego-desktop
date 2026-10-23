import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import {
  buildSvgNode,
  isSvgFile,
  MAX_EMBED_SIDE,
  placementSize,
  scaleDownToFit,
} from "@/interaction/image-file";

describe("scaleDownToFit", () => {
  test("never enlarges", () => {
    expect(scaleDownToFit({ width: 300, height: 200 }, 800)).toEqual({ width: 300, height: 200 });
  });
  test("shrinks the longest side, keeping the ratio", () => {
    expect(scaleDownToFit({ width: 5120, height: 2560 }, MAX_EMBED_SIDE)).toEqual({
      width: 2560,
      height: 1280,
    });
    expect(scaleDownToFit({ width: 1000, height: 4000 }, 800)).toEqual({ width: 200, height: 800 });
  });
  test("keeps at least one pixel", () => {
    expect(scaleDownToFit({ width: 10000, height: 1 }, 800)).toEqual({ width: 800, height: 1 });
  });
});

describe("placementSize", () => {
  test("caps the longest side at 800", () => {
    expect(placementSize({ width: 1600, height: 900 })).toEqual({ width: 800, height: 450 });
    expect(placementSize({ width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
  });
});

describe("SVG files", () => {
  const doc = {
    version: 7,
    id: "doc",
    name: "Test",
    variables: {},
    children: [{ type: "page", id: "p1", name: "Page 1", children: [] }],
  } as unknown as PegoDocument;
  const onPage = { parentId: "p1", originX: 0, originY: 0, flex: false };

  test("are recognized by type, or by name when the type is missing", () => {
    expect(isSvgFile({ name: "icon.svg", type: "image/svg+xml" })).toBe(true);
    expect(isSvgFile({ name: "Logo.SVG", type: "" })).toBe(true);
    expect(isSvgFile({ name: "shot.png", type: "image/png" })).toBe(false);
  });

  test("become vector layers centered on the point", () => {
    const node = buildSvgNode(
      doc,
      '<svg viewBox="0 0 10 20"><rect width="10" height="20" fill="#f00"/></svg>',
      "icon",
      onPage,
      { x: 100, y: 100 },
    );
    expect(node).toMatchObject({
      type: "frame",
      name: "icon",
      width: 10,
      height: 20,
      x: 95,
      y: 90,
    });
    expect(node?.type === "frame" ? node.children[0]?.type : null).toBe("rectangle");
  });

  test("larger ones are scaled to the placement size, still as vectors", () => {
    const node = buildSvgNode(
      doc,
      '<svg viewBox="0 0 1600 800"><rect width="1600" height="800" fill="#00f"/></svg>',
      "banner",
      onPage,
      { x: 0, y: 0 },
    );
    expect(node).toMatchObject({ type: "frame", width: 800, height: 400, x: -400, y: -200 });
  });

  test("markup that cannot be converted gives null (placed as an image instead)", () => {
    expect(
      buildSvgNode(doc, "<svg><script>alert(1)</script></svg>", "bad", onPage, { x: 0, y: 0 }),
    ).toBeNull();
    expect(buildSvgNode(doc, "not svg", "bad", onPage, { x: 0, y: 0 })).toBeNull();
  });
});
