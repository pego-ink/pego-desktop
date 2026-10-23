import { describe, expect, test } from "bun:test";
import type { Layout, PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { exportSvg } from "./svg";
import { docWith } from "./test-docs";

const hero = (): PegoNode =>
  ({
    type: "frame",
    id: "root",
    name: "Hero",
    layout: "vertical",
    width: 400,
    height: 200,
    fill: { type: "shader", preset: "aurora", uniforms: { color1: "#101828" } },
    children: [{ type: "text", id: "t", content: "Hello", fill: "#FFFFFF" }],
  }) as unknown as PegoNode;

const file = (files: { path: string; contents: string }[], path: string) =>
  files.find((f) => f.path === path)?.contents ?? "";

describe("shader fill export", () => {
  test("html-css: fallback background, the shader on the element and the runtime", () => {
    const files = exportCode(docWith(hero()), "root", { format: "html-css" });
    const html = file(files, "index.html");
    expect(file(files, "styles.css")).toContain("background-color: #101828;");
    const attr = /data-pego-shader="([^"]*)"/.exec(html)?.[1];
    expect(attr).toBeDefined();
    const spec = JSON.parse(attr!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(spec.animated).toBe(true);
    expect(spec.glsl).toContain("gl_FragColor = pego_main(css);");
    expect(spec.uniforms.color1).toEqual([16 / 255, 24 / 255, 40 / 255, 1]);
    expect(spec.uniforms.speed).toEqual([0.6]);
    expect(html).toContain('querySelectorAll("[data-pego-shader]")');
    expect(html).toContain(")(document);");
  });

  test("react-tailwind: the root starts the shaders from pego-shaders.js", () => {
    const files = exportCode(docWith(hero()), "root", { format: "react-tailwind" });
    const component = file(files, "components/Hero.tsx");
    expect(component).toStartWith(
      'import { useEffect } from "react";\nimport { startPegoShaders } from "../pego-shaders";\n',
    );
    expect(component).toContain("useEffect(() => startPegoShaders(document), []);");
    expect(component).toContain("data-pego-shader={");
    expect(file(files, "pego-shaders.js")).toContain("export const startPegoShaders = (root) => {");
  });

  test("svg shows the first color, and plain designs get no runtime", () => {
    const layout: Layout = new Map([
      ["root", { x: 0, y: 0, width: 400, height: 200 }],
      ["t", { x: 0, y: 0, width: 40, height: 20 }],
    ]);
    expect(exportSvg(docWith(hero()), "root", { layout })).toContain('fill="#101828"');
    const plain = {
      type: "rectangle",
      id: "root",
      width: 10,
      height: 10,
      fill: "#fff",
    } as PegoNode;
    const files = exportCode(docWith(plain), "root", { format: "html-css" });
    expect(file(files, "index.html")).not.toContain("data-pego-shader");
    expect(
      exportCode(docWith(plain), "root", { format: "react-tailwind" }).map((f) => f.path),
    ).not.toContain("pego-shaders.js");
  });
});
