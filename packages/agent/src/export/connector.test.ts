import { describe, expect, test } from "bun:test";
import { computeLayout, type PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { exportSvg } from "./svg";
import { docWith } from "./test-docs";

// A wireflow wrapped in a frame: two screens and a labelled arrow between them.
const flow = {
  type: "frame",
  id: "flow",
  name: "Flow",
  layout: "none",
  x: 100,
  y: 50,
  width: 600,
  height: 300,
  children: [
    { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 200, fill: "#ffffff" },
    { type: "rectangle", id: "b", x: 300, y: 0, width: 100, height: 200, fill: "#ffffff" },
    {
      type: "connector",
      id: "c",
      x: 0,
      y: 0,
      from: { id: "a" },
      to: { id: "b" },
      label: "Tap",
      stroke: { color: "#ff0000", width: 2 },
    },
  ],
} as unknown as PegoNode;

describe("connector export", () => {
  const doc = docWith(flow);
  const layout = computeLayout(doc, () => ({ width: 0, height: 0 }));

  test("svg draws the line in the frame's coordinates, with its arrow and label", () => {
    const svg = exportSvg(doc, "flow", { layout });
    // The line runs from a's right side (100,100) to b's left side (300,100), frame-relative.
    expect(svg).toContain('<g transform="translate(100 100)"><g transform="translate(-200 -150)">');
    expect(svg).toContain('d="M 200 150 L 400 150"');
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain("<polyline points=");
    expect(svg).toContain(">Tap</text>");
  });

  test("code export leaves connectors out of the markup", () => {
    const html = exportCode(doc, "flow", { format: "html-css" })
      .map((f) => f.contents)
      .join("\n");
    expect(html).not.toContain("Tap");
  });
});
