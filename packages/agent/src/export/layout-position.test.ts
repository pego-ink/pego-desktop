import { describe, expect, test } from "bun:test";
import type { PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { docWith } from "./test-docs";

// A screen with content in the flow and a bottom sheet over it.
const screen = {
  type: "frame",
  id: "screen",
  name: "Screen",
  layout: "vertical",
  clip: true,
  x: 0,
  y: 0,
  width: 390,
  height: 844,
  children: [
    { type: "rectangle", id: "content", name: "Content", width: "fill_container", height: 200 },
    {
      type: "rectangle",
      id: "overlay",
      name: "Overlay",
      layoutPosition: "absolute",
      width: "fill_container",
      height: "fill_container",
      fill: "#0F172A80",
    },
    {
      type: "rectangle",
      id: "sheet",
      name: "Sheet",
      layoutPosition: "absolute",
      x: 0,
      y: 462,
      width: 390,
      height: 382,
      fill: "#ffffff",
    },
  ],
} as unknown as PegoNode;

const html = () =>
  exportCode(docWith(screen), "screen", { format: "html-css" })
    .map((f) => f.contents)
    .join("\n");

const ruleOf = (css: string, name: string): string => {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for .${name} in\n${css}`);
  return match[1]!;
};

describe("layoutPosition export", () => {
  test("absolute children of a flex frame are positioned from it, out of the flow", () => {
    const css = html();
    expect(ruleOf(css, "screen")).toContain("display: flex");
    expect(ruleOf(css, "screen")).toContain("position: relative");
    const sheet = ruleOf(css, "sheet");
    expect(sheet).toContain("position: absolute");
    expect(sheet).toContain("left: 0");
    expect(sheet).toContain("top: 462px");
    const overlay = ruleOf(css, "overlay");
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("width: 100%");
    expect(overlay).toContain("height: 100%");
    expect(overlay).not.toContain("flex");
  });

  test("flow children stay flex items", () => {
    const content = ruleOf(html(), "content");
    expect(content).not.toContain("position: absolute");
    expect(content).toContain("align-self: stretch");
  });
});
