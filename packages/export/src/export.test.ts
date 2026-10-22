import { describe, expect, test } from "bun:test";
import { computeLayout, documentSchema, type PegoDocument, type TextNode } from "@pego/doc";
import { exportHtml } from "./html";
import { exportSvg } from "./svg";

const doc: PegoDocument = documentSchema.parse({
  version: 2,
  id: "d",
  name: "Export",
  variables: {
    accent: { type: "color", value: "#4F46E5" },
    gap: { type: "number", value: 12 },
    ui: { type: "string", value: "Geist" },
  },
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "btn",
          name: "Button",
          reusable: true,
          x: 1000,
          layout: "horizontal",
          padding: [8, 16, 8, 16],
          fill: "$accent",
          cornerRadius: 8,
          children: [{ type: "text", id: "label", content: "Buy", fill: "#FFFFFF" }],
        },
        {
          type: "frame",
          id: "card",
          name: "Pricing Card",
          width: 320,
          layout: "vertical",
          gap: "$gap",
          padding: 24,
          fill: {
            type: "linear",
            angle: 135,
            stops: [
              { color: "#FFFFFF", position: 0 },
              { color: "#EEF2FF80", position: 1 },
            ],
          },
          stroke: { color: "#E5E7EB", width: [0, 0, 1, 0] },
          effects: [{ type: "shadow", color: "#0000001F", y: 8, blur: 24 }],
          children: [
            {
              type: "text",
              id: "title",
              name: "Title",
              content: "Pro <plan> & more",
              fontFamily: "$ui",
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.4,
            },
            {
              type: "text",
              id: "body",
              name: "Body",
              content: "Line one\nLine two",
              width: "fill_container",
            },
            {
              type: "ref",
              id: "cta",
              ref: "btn",
              width: "fill_container",
              descendants: { label: { content: "Start" } },
            },
            {
              type: "frame",
              id: "art",
              name: "Art",
              width: 100,
              height: 60,
              clip: true,
              children: [
                {
                  type: "ellipse",
                  id: "dot",
                  x: 10,
                  y: 20,
                  width: 16,
                  height: 16,
                  fill: "#22C55E",
                },
                {
                  type: "icon",
                  id: "ic",
                  x: 40,
                  y: 10,
                  width: 24,
                  height: 24,
                  iconName: "check",
                  fill: "$accent",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const measure = (node: TextNode, maxWidth: number | undefined) => {
  const lines = node.content.split("\n");
  const width = Math.max(...lines.map((line) => line.length * 8));
  return { width: maxWidth ?? width, height: lines.length * 20 };
};
const layout = computeLayout(doc, measure);
const icon = (name: string) => (name === "check" ? '<path d="M20 6 9 17l-5-5"/>' : null);

describe("exportHtml", () => {
  const html = exportHtml(doc, layout, "card", { icon });

  test("is a full page with variables and the fonts used", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("--accent: #4F46E5;");
    expect(html).toContain("--gap: 12;");
    expect(html).toContain('--ui: "Geist";');
    expect(html).toContain("family=Geist:wght@600");
    expect(html).toContain("family=Inter:wght@400");
  });

  test("maps flex frames to flexbox with variable gaps", () => {
    expect(html).toMatch(
      /\.pricing-card \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*align-items: flex-start;[^}]*gap: calc\(var\(--gap\) \* 1px\);[^}]*padding: 24px;/s,
    );
    expect(html).toContain("background: linear-gradient(135deg, #FFFFFF 0%, #EEF2FF80 100%);");
    expect(html).toContain("box-shadow: 0px 8px 24px #0000001F, inset 0 -1px 0 #E5E7EB;");
  });

  test("fill children flex, absolute children keep their offsets", () => {
    expect(html).toMatch(/\.body \{[^}]*align-self: stretch;[^}]*white-space: pre-wrap;/s);
    expect(html).toMatch(/\.ellipse \{[^}]*position: absolute;[^}]*left: 10px;[^}]*top: 20px;/s);
    expect(html).toMatch(
      /\.art \{\n {2}flex-shrink: 0;\n {2}height: 60px;\n {2}width: 100px;\n {2}overflow: hidden;\n\}/,
    );
  });

  test("expands instances with overrides and escapes text", () => {
    expect(html).toMatch(
      /<div class="button" data-name="Button">\s*<p class="text"[^>]*>Start<\/p>/,
    );
    expect(html).toContain("Pro &lt;plan&gt; &amp; more");
    expect(html).toContain('stroke="var(--accent)"');
    expect(html).toContain('<path d="M20 6 9 17l-5-5"/>');
  });

  test("throws for an unknown root", () => {
    expect(() => exportHtml(doc, layout, "nope")).toThrow(/Unknown node/);
  });
});

describe("exportSvg", () => {
  const svg = exportSvg(doc, layout, "card", { icon });
  const box = layout.get("card")!;

  test("is sized to the root and has balanced groups", () => {
    expect(svg).toStartWith(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"`,
    );
    expect(svg.match(/<g[ >]/g)?.length).toBe(svg.match(/<\/g>|<g [^>]*\/>/g)?.length);
  });

  test("writes gradients, shadows, clip paths and split alpha colors", () => {
    expect(svg).toMatch(/<linearGradient id="paint\d+" gradientUnits="userSpaceOnUse"/);
    expect(svg).toContain('<stop offset="1" stop-color="#EEF2FF" stop-opacity="0.502"/>');
    expect(svg).toMatch(/<filter id="fx\d+"[^>]*>.*feGaussianBlur in="s0o" stdDeviation="12"/);
    expect(svg).toMatch(/<clipPath id="clip\d+"><rect width="100" height="60"\/><\/clipPath>/);
  });

  test("resolves variables and lays out text lines", () => {
    expect(svg).toContain('font-family="Geist, sans-serif"');
    expect(svg).toContain(
      '<tspan x="0" y="13.3">Line one</tspan><tspan x="0" y="30.1">Line two</tspan>',
    );
    expect(svg).toContain(">Start</tspan>");
    expect(svg).toContain('stroke="#4F46E5"');
  });

  test("uses the injected line breaker when given", () => {
    const custom = exportSvg(doc, layout, "title", {
      textLines: () => [{ text: "Pro", x: 2, baseline: 18 }],
    });
    expect(custom).toContain('<tspan x="2" y="18">Pro</tspan>');
  });
});
