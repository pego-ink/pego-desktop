import { describe, expect, test } from "bun:test";
import type { Layout, PegoNode } from "@pego/doc";
import { exportCode } from "./code";
import { exportSvg } from "./svg";
import { docWith, exportDoc } from "./test-docs";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const frame = (props: Record<string, unknown>, children: PegoNode[] = []): PegoNode =>
  ({
    type: "frame",
    id: "f",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    layout: "none",
    children,
    ...props,
  }) as PegoNode;

const child = (props: Record<string, unknown>): PegoNode =>
  ({ id: "c", x: 0, y: 0, width: 50, height: 40, ...props }) as PegoNode;

const layout: Layout = new Map([
  ["f", { x: 0, y: 0, width: 200, height: 100 }],
  ["c", { x: 0, y: 0, width: 50, height: 40 }],
]);

const html = (node: PegoNode, id = "f") => {
  const out = exportCode(docWith(node), id, { format: "html-css" });
  return {
    html: out.find((f) => f.path === "index.html")?.contents ?? "",
    css: out.find((f) => f.path === "styles.css")?.contents ?? "",
  };
};
const react = (node: PegoNode, id = "f") =>
  exportCode(docWith(node), id, { format: "react-tailwind" }).find((f) => f.path.endsWith(".tsx"))
    ?.contents ?? "";
const svg = (node: PegoNode, id = "f") => exportSvg(docWith(node), id, { layout });

const linear = {
  type: "linear",
  angle: 90,
  stops: [
    { color: "#ff0000", position: 0 },
    { color: "#0000ff80", position: 1 },
  ],
};
const radial = {
  type: "radial",
  center: [0.25, 0.75],
  radius: [0.5, 0.5],
  stops: [
    { color: "$accent", position: 0 },
    { color: "#000000", position: 1 },
  ],
};

describe("gradients", () => {
  test("html-css: linear and radial gradient backgrounds", () => {
    expect(html(frame({ fill: linear })).css).toContain(
      "background-image: linear-gradient(90deg, #ff0000 0%, #0000ff80 100%);",
    );
    expect(html(frame({ fill: radial })).css).toContain(
      "background-image: radial-gradient(50% 50% at 25% 75%, var(--accent) 0%, #000000 100%);",
    );
  });

  test("react-tailwind: arbitrary bg classes, color variables use theme tokens", () => {
    expect(react(frame({ fill: linear }))).toContain(
      "bg-[linear-gradient(90deg,#ff0000_0%,#0000ff80_100%)]",
    );
    expect(react(frame({ fill: radial }))).toContain(
      "bg-[radial-gradient(50%_50%_at_25%_75%,var(--color-accent)_0%,#000000_100%)]",
    );
  });

  test("svg: gradient defs in node coordinates, alpha split into stop-opacity", () => {
    const out = svg(frame({ fill: linear }));
    expect(out).toContain(
      '<linearGradient id="paint1" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="200" y2="50">',
    );
    expect(out).toContain('<stop offset="1" stop-color="#0000ff" stop-opacity="0.5">');
    expect(out).toContain('<rect width="200" height="100" fill="url(#paint1)" />');
    expect(svg(frame({ fill: radial }))).toContain('gradientTransform="matrix(100 0 0 50 50 75)"');
  });

  test("a path gradient is drawn in an inline svg paint server", () => {
    const path = child({ type: "path", geometry: "M0 0 L40 40", fill: linear });
    expect(html(frame({}, [path])).html).toContain('fill="url(#paint1)"');
    expect(html(frame({}, [path])).html).toContain("<linearGradient");
  });
});

describe("image fills", () => {
  const fill = (fit: string) => ({ type: "image", src: IMG, fit });

  test("html-css: background url with size per fit", () => {
    const css = html(frame({ fill: fill("cover") })).css;
    expect(css).toContain(`background-image: url("${IMG}");`);
    expect(css).toContain("background-size: cover;");
    expect(css).toContain("background-position: center;");
    expect(css).toContain("background-repeat: no-repeat;");
    expect(html(frame({ fill: fill("contain") })).css).toContain("background-size: contain;");
    expect(html(frame({ fill: fill("stretch") })).css).toContain("background-size: 100% 100%;");
  });

  test("react-tailwind: size classes, data url stays in an inline style", () => {
    const tsx = react(frame({ fill: fill("cover") }));
    expect(tsx).toContain("bg-center bg-cover bg-no-repeat");
    expect(tsx).toContain("backgroundImage");
    expect(react(frame({ fill: fill("stretch") }))).toContain("bg-[length:100%_100%]");
  });

  test("svg: pattern with an image that keeps the fit", () => {
    const out = svg(frame({ fill: fill("cover") }));
    expect(out).toContain('<pattern id="paint1" patternUnits="userSpaceOnUse"');
    expect(out).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(out).toContain('fill="url(#paint1)"');
    expect(svg(frame({ fill: fill("contain") }))).toContain("xMidYMid meet");
    expect(svg(frame({ fill: fill("stretch") }))).toContain('preserveAspectRatio="none"');
  });
});

describe("per-side strokes", () => {
  const stroke = { color: "#112233", width: [1, 0, 3, 0] };

  test("html-css: one border per visible side", () => {
    const css = html(frame({ stroke })).css;
    expect(css).toContain("border-top: 1px solid #112233;");
    expect(css).toContain("border-bottom: 3px solid #112233;");
    expect(css).not.toContain("border-right");
    expect(css).not.toContain("border-left");
  });

  test("react-tailwind: border-t / border-b classes", () => {
    const tsx = react(frame({ stroke }));
    expect(tsx).toContain("border-t border-[#112233]");
    expect(tsx).toContain("border-b-[3px]");
    expect(tsx).not.toContain("border-r");
  });

  test("a single width keeps the plain border", () => {
    expect(html(frame({ stroke: { color: "#112233", width: 2 } })).css).toContain(
      "border: 2px solid #112233;",
    );
  });

  test("svg: bars along the visible edges, clipped to the shape", () => {
    const out = svg(frame({ stroke, cornerRadius: 8 }));
    expect(out).toContain('<rect x="0" y="0" width="200" height="1" fill="#112233" />');
    expect(out).toContain('<rect x="0" y="97" width="200" height="3" fill="#112233" />');
    expect(out).toContain(
      '<clipPath id="clip1"><rect width="200" height="100" rx="8" /></clipPath>',
    );
    expect(out).not.toContain("stroke-width");
  });
});

describe("effects", () => {
  const effects = [
    { type: "shadow", color: "#00000040", x: 0, y: 4, blur: 8 },
    { type: "shadow", inner: true, color: "#ffffff", x: 0, y: 1, blur: 2, spread: 1 },
    { type: "blur", radius: 3 },
  ];

  test("html-css: box-shadow (inset for inner) and filter blur", () => {
    const css = html(frame({ effects })).css;
    expect(css).toContain("box-shadow: 0 4px 8px #00000040, inset 0 1px 2px 1px #ffffff;");
    expect(css).toContain("filter: blur(3px);");
  });

  test("react-tailwind: shadow and blur classes", () => {
    const tsx = react(frame({ effects }));
    expect(tsx).toContain("shadow-[0_4px_8px_#00000040,inset_0_1px_2px_1px_#ffffff]");
    expect(tsx).toContain("blur-[3px]");
  });

  test("text shadows use text-shadow, icons and paths use drop-shadow", () => {
    const shadow = [{ type: "shadow", color: "#000000", x: 1, y: 2, blur: 3 }];
    const text = child({ type: "text", content: "Hi", effects: shadow });
    expect(html(frame({}, [text])).css).toContain("text-shadow: 1px 2px 3px #000000;");
    const path = child({ type: "path", geometry: "M0 0 L9 9", effects: shadow });
    expect(html(frame({}, [path])).css).toContain("filter: drop-shadow(1px 2px 3px #000000);");
  });

  test("svg: shadow filter on the shape, blur filter on the whole layer", () => {
    const out = svg(frame({ fill: "#ffffff", effects }, [child({ type: "rectangle" })]));
    expect(out).toContain('<feGaussianBlur in="s0o" stdDeviation="4" result="s0b"/>');
    expect(out).toContain('<feComposite in="SourceAlpha" in2="s1b" operator="arithmetic"');
    expect(out).toContain('<feMerge><feMergeNode in="s0"/><feMergeNode in="SourceGraphic"/>');
    expect(out).toContain('<feGaussianBlur stdDeviation="3"/>');
    expect(out).toMatch(/<rect width="200" height="100" fill="#ffffff" filter="url\(#fx\d\)" \/>/);
    expect(out).toMatch(/<g filter="url\(#fx\d\)"><rect width="200"/);
  });
});

describe("text spacing", () => {
  const text = child({
    type: "text",
    content: "Hi",
    fontSize: 20,
    lineHeight: 1.5,
    letterSpacing: 2,
  });

  test("html-css: unitless line-height and px letter-spacing", () => {
    const css = html(frame({}, [text])).css;
    expect(css).toContain("line-height: 1.5;");
    expect(css).toContain("letter-spacing: 2px;");
  });

  test("react-tailwind: leading and tracking classes", () => {
    expect(react(frame({}, [text]))).toContain("leading-[1.5] tracking-[2px]");
  });

  test("svg: letter-spacing attribute and baseline for the line height", () => {
    const out = svg(frame({}, [text]));
    expect(out).toContain('letter-spacing="2"');
    // baseline = 20 * 0.97 + (30 - 20 * 1.21) / 2
    expect(out).toContain('y="22.3"');
  });
});

describe("path viewBox", () => {
  const path = child({
    type: "path",
    width: 100,
    height: 50,
    geometry: "M0 0 L10 10",
    viewBox: [0, 0, 10, 10],
    stroke: { color: "#000000", width: 2 },
  });

  test("html-css and react: svg viewBox scales the geometry to the node size", () => {
    const out = html(frame({}, [path])).html;
    expect(out).toContain('width="100" height="50" viewBox="0 0 10 10" preserveAspectRatio="none"');
    expect(out).toContain('vector-effect="non-scaling-stroke"');
    expect(react(frame({}, [path]))).toContain('viewBox="0 0 10 10"');
  });

  test("svg: nested svg scales the geometry", () => {
    const out = svg(frame({}, [path]));
    expect(out).toContain(
      '<svg width="50" height="40" viewBox="0 0 10 10" preserveAspectRatio="none" overflow="visible">',
    );
    expect(out).toContain('vector-effect="non-scaling-stroke"');
  });
});

describe("pages", () => {
  const doc = {
    ...exportDoc,
    children: [
      ...exportDoc.children,
      {
        type: "page" as const,
        id: "page-2",
        name: "Page 2",
        x: 0,
        y: 0,
        children: [
          {
            type: "frame" as const,
            id: "second",
            x: 0,
            y: 0,
            width: 80,
            height: 40,
            layout: "none" as const,
            fill: "#123456",
            children: [],
          },
        ],
      },
    ],
  };

  test("a node on a non-first page exports", () => {
    const css = exportCode(doc, "second", { format: "html-css" }).find(
      (f) => f.path === "styles.css",
    )?.contents;
    expect(css).toContain("background-color: #123456;");
    const layout: Layout = new Map([["second", { x: 0, y: 0, width: 80, height: 40 }]]);
    expect(exportSvg(doc, "second", { layout })).toContain('fill="#123456"');
  });

  test("a page is rejected with a clear error", () => {
    expect(() => exportCode(doc, "page-1", { format: "html-css" })).toThrow(
      "page cannot be exported",
    );
    expect(() => exportSvg(doc, "page-2", { layout })).toThrow("page cannot be exported");
  });
});
