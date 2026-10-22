import { describe, expect, test } from "bun:test";
import type { Layout } from "@pego/doc";
import { exportSvg } from "./svg";
import { docWith, exportDoc } from "./test-docs";

const layout: Layout = new Map([
  ["page", { x: 100, y: 0, width: 400, height: 300 }],
  ["title", { x: 124, y: 100, width: 120, height: 48 }],
  ["overlay", { x: 124, y: 200, width: 200, height: 100 }],
  ["swatch", { x: 134, y: 220, width: 50, height: 40 }],
  ["dot", { x: 204, y: 220, width: 30, height: 30 }],
  ["line", { x: 244, y: 220, width: 40, height: 20 }],
  ["photo", { x: 124, y: 200, width: 10, height: 10 }],
]);

describe("exportSvg", () => {
  const svg = exportSvg(exportDoc, "page", { layout });

  test("sizes the document to the node box", () => {
    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">',
    );
    expect(svg).toContain('<rect width="400" height="300" fill="#ffffff" />');
  });

  test("places children relative to the parent box", () => {
    expect(svg).toContain('<g transform="translate(24 100)">');
    expect(svg).toContain(
      '<rect width="50" height="40" rx="4" fill="#ff8800" stroke="#000000" stroke-width="2" />',
    );
  });

  test("rotation turns counter-clockwise around the top-left corner", () => {
    expect(svg).toContain("translate(80 20) rotate(-45)");
  });

  test("resolves variables and draws ellipses, paths and text", () => {
    expect(svg).toContain('<ellipse cx="15" cy="15" rx="15" ry="15" fill="#0e7c5a" />');
    expect(svg).toContain('<path d="M0 0 L40 20" fill="none" stroke="#000000" stroke-width="2" />');
    expect(svg).toContain("font-family=\"'Playfair Display', sans-serif\"");
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain(">Welcome</text>");
  });

  test("references fonts by family via a google fonts import", () => {
    expect(svg).toContain(
      "<defs><style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&amp;display=swap');</style>",
    );
  });

  test("images keep their source and clip to the box", () => {
    expect(svg).toContain(
      '<image href="https://example.com/a.png" width="10" height="10" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip1)" />',
    );
    expect(svg).toContain('<clipPath id="clip1"><rect width="10" height="10" /></clipPath>');
  });

  test("clip frames wrap their children in a clip group", () => {
    const doc = docWith({
      type: "frame" as const,
      id: "f",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      layout: "none" as const,
      clip: true,
      cornerRadius: 10,
      fill: "#112233",
      children: [
        {
          type: "rectangle" as const,
          id: "r",
          x: 90,
          y: 0,
          width: 40,
          height: 50,
          fill: "#ffffff80",
        },
      ],
    });
    const out = exportSvg(doc, "f", {
      layout: new Map([
        ["f", { x: 0, y: 0, width: 100, height: 50 }],
        ["r", { x: 90, y: 0, width: 40, height: 50 }],
      ]),
    });
    expect(out).toContain(
      '<clipPath id="clip1"><rect width="100" height="50" rx="10" /></clipPath>',
    );
    expect(out).toContain('<g clip-path="url(#clip1)">');
    expect(out).toContain('fill="#ffffff" fill-opacity="0.5"');
  });

  test("throws for unknown nodes and nodes without layout", () => {
    expect(() => exportSvg(exportDoc, "nope", { layout })).toThrow("Unknown node");
    expect(() => exportSvg(exportDoc, "button", { layout })).toThrow("no layout");
  });
});
