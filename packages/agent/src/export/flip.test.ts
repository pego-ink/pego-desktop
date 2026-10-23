import { describe, expect, test } from "bun:test";
import type { Layout, PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { exportSvg } from "./svg";
import { docWith } from "./test-docs";

const frame = (props: Record<string, unknown>, rootProps: Record<string, unknown> = {}): PegoNode =>
  ({
    type: "frame",
    id: "root",
    layout: "none",
    ...rootProps,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    children: [
      {
        type: "frame",
        id: "card",
        x: 80,
        y: 20,
        width: 100,
        height: 60,
        fill: "#336699",
        layout: "none",
        children: [{ type: "rectangle", id: "dot", x: 10, y: 5, width: 20, height: 20 }],
        ...props,
      },
    ],
  }) as PegoNode;

const layout: Layout = new Map([
  ["root", { x: 0, y: 0, width: 300, height: 200 }],
  ["card", { x: 80, y: 20, width: 100, height: 60 }],
  ["dot", { x: 90, y: 25, width: 20, height: 20 }],
]);

const svgOf = (props: Record<string, unknown>) =>
  exportSvg(docWith(frame(props)), "root", { layout });

const pageOf = (props: Record<string, unknown>, format: "react-tailwind" | "html-css") =>
  exportCode(docWith(frame(props)), "root", { format })
    .map((f) => f.contents)
    .join("\n");

describe("flip export", () => {
  test("svg mirrors around the box center after the rotation", () => {
    expect(svgOf({ flipX: true })).toContain("translate(80 20) translate(100 0) scale(-1 1)");
    expect(svgOf({ flipY: true })).toContain("translate(0 60) scale(1 -1)");
    expect(svgOf({ flipX: true, flipY: true, rotation: 30 })).toContain(
      "translate(80 20) rotate(-30) translate(100 60) scale(-1 -1)",
    );
  });

  test("svg without a flip has no scale", () => {
    expect(svgOf({})).not.toContain("scale(");
  });

  test("a flipped root keeps its mirror", () => {
    const svg = exportSvg(docWith(frame({}, { flipX: true })), "root", { layout });
    expect(svg).toContain("translate(300 0) scale(-1 1)");
  });

  test("css uses scaleX / scaleY alone and combines with rotation from the top-left", () => {
    expect(pageOf({ flipX: true }, "html-css")).toContain("transform: scaleX(-1)");
    expect(pageOf({ flipY: true }, "html-css")).toContain("transform: scaleY(-1)");
    const rotated = pageOf({ flipX: true, rotation: 30 }, "html-css");
    expect(rotated).toContain("transform-origin: top left");
    expect(rotated).toContain("transform: rotate(-30deg) translate(100px, 0) scale(-1, 1)");
  });

  test("tailwind maps a lone flip to a utility class", () => {
    expect(pageOf({ flipX: true }, "react-tailwind")).toContain("-scale-x-100");
    expect(pageOf({ flipY: true }, "react-tailwind")).toContain("-scale-y-100");
  });
});
