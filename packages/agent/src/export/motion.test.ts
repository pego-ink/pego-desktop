import { describe, expect, test } from "bun:test";
import type { PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { docWith } from "./test-docs";

const chart = (): PegoNode =>
  ({
    type: "frame",
    id: "root",
    name: "Chart",
    layout: "horizontal",
    gap: 8,
    children: [
      {
        type: "rectangle",
        id: "bar1",
        name: "Bar one",
        width: 40,
        height: 120,
        fill: "#E5A33A",
        animation: { preset: "grow_up", delay: 0, duration: 500 },
      },
      {
        type: "rectangle",
        id: "bar2",
        name: "Bar two",
        width: 40,
        height: 160,
        fill: "#C0392B",
        animation: { preset: "grow_up", delay: 150, duration: 500, easing: "spring" },
      },
      {
        type: "text",
        id: "pct",
        name: "Percent",
        content: "70%",
        animation: { preset: "fade", delay: 300, countUp: true },
      },
    ],
  }) as PegoNode;

const file = (files: { path: string; contents: string }[], path: string) =>
  files.find((f) => f.path === path)?.contents ?? "";

describe("motion export", () => {
  test("html-css: keyframes, timing per node, bar origin and the count-up script", () => {
    const files = exportCode(docWith(chart()), "root", { format: "html-css" });
    const css = file(files, "styles.css");
    const html = file(files, "index.html");
    expect(css).toContain("@keyframes pego-grow-up {\n  from {\n    scale: 1 0;\n  }\n}");
    expect(css).toContain("@keyframes pego-fade {");
    expect(css).toContain("animation: pego-grow-up 500ms cubic-bezier(0.22, 1, 0.36, 1) 0ms both;");
    expect(css).toContain(
      "animation: pego-grow-up 500ms cubic-bezier(0.34, 1.56, 0.64, 1) 150ms both;",
    );
    expect(css).toContain("transform-origin: bottom;");
    expect(css).toContain("prefers-reduced-motion");
    expect(html).toContain('data-count-up="300 600 0.22 1 0.36 1"');
    expect(html).toContain('querySelectorAll("[data-count-up]")');
  });

  test("react-tailwind: keyframes in styles.css, the animation inline", () => {
    const files = exportCode(docWith(chart()), "root", { format: "react-tailwind" });
    expect(file(files, "styles.css")).toContain("@keyframes pego-grow-up");
    expect(file(files, "components/Chart.tsx")).toContain("pego-grow-up 500ms");
  });

  test("no animation, no motion CSS or script", () => {
    const plain = { type: "rectangle", id: "root", width: 10, height: 10 } as PegoNode;
    const files = exportCode(docWith(plain), "root", { format: "html-css" });
    expect(file(files, "styles.css")).not.toContain("@keyframes");
    expect(file(files, "index.html")).not.toContain("data-count-up");
  });
});
