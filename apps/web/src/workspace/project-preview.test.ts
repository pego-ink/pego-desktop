/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { fitPreviewCamera, previewFile } from "./project-preview";

describe("project previews", () => {
  test("shows the most recently changed file", () => {
    const file = (relativePath: string, modifiedAt: number) => ({
      path: `/d/${relativePath}`,
      relativePath,
      size: 1,
      modifiedAt,
    });
    expect(
      previewFile([file("a.pego", 5), file("b.pego", 9), file("c.pego", 1)])?.relativePath,
    ).toBe("b.pego");
    expect(previewFile([])).toBeNull();
  });

  test("fits and centers the content with padding", () => {
    // 1200x600 content into 640x360 with 24 px padding: width-bound (592 / 1200).
    const camera = fitPreviewCamera({ x: 100, y: 50, width: 1200, height: 600 });
    expect(camera.zoom).toBeCloseTo(592 / 1200);
    const left = 100 * camera.zoom + camera.panX;
    const right = (100 + 1200) * camera.zoom + camera.panX;
    expect(left).toBeCloseTo(24);
    expect(right).toBeCloseTo(640 - 24);
    const top = 50 * camera.zoom + camera.panY;
    expect(top + (600 * camera.zoom) / 2).toBeCloseTo(180);
  });
});
