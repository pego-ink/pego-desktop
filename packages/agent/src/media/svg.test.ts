import { describe, expect, test } from "bun:test";
import { convertSvg, SvgError, type RawNode } from "./svg";
import { parseColor, parseStyleAttribute } from "./svg-style";
import { parsePathData, parseTransform, serializeSegments } from "./svg-geometry";
import type { Layout, PegoNode } from "@pego/doc";
import { exportSvg } from "../export/svg";
import { docWith } from "../export/test-docs";
import { parseXml } from "./xml";

const kids = (node: RawNode): RawNode[] => node.children as RawNode[];
const first = (svg: string, options = {}) => {
  const result = convertSvg(svg, options);
  return { ...result, root: result.node, child: kids(result.node)[0] as RawNode };
};
const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const rejects = (svg: string, code: string) => {
  try {
    convertSvg(svg);
  } catch (error) {
    expect(error).toBeInstanceOf(SvgError);
    expect((error as SvgError).code).toBe(code);
    return;
  }
  throw new Error("expected rejection");
};

describe("xml", () => {
  test("parses attributes, entities, comments and CDATA", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y='&#65;'><b/><![CDATA[<raw>]]>t</a>`,
    );
    expect(root.attrs).toEqual({ x: "1 & 2", y: "A" });
    expect(root.children).toHaveLength(1);
    expect(root.text).toBe("<raw>t");
  });

  test("rejects DTD with entities, malformed and deep input", () => {
    expect(() => parseXml(`<!DOCTYPE a [<!ENTITY x "y">]><a/>`)).toThrow(/DTD/);
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a>")).toThrow(/unclosed/);
    expect(() => parseXml("<a/><b/>")).toThrow(/more than one root/);
    expect(() => parseXml("<a x=1/>")).toThrow(/quoted/);
    expect(() => parseXml("<a x='1' x='2'/>")).toThrow(/duplicate/);
    expect(() => parseXml("<a>".repeat(80) + "</a>".repeat(80))).toThrow(/deeper/);
  });
});

describe("transform, path, style helpers", () => {
  test("parses translate, scale, rotate and matrix", () => {
    expect(parseTransform("translate(10 20)").matrix).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform("translate(5) scale(2)").matrix).toEqual([2, 0, 0, 2, 5, 0]);
    expect(parseTransform("matrix(1,2,3,4,5,6)").matrix).toEqual([1, 2, 3, 4, 5, 6]);
    const r = parseTransform("rotate(90 10 10)").matrix;
    expect(r[4]).toBeCloseTo(20);
    expect(r[5]).toBeCloseTo(0);
    expect(parseTransform("bogus(1)").unsupported).toEqual(["bogus"]);
  });

  test("normalizes relative commands, H/V, compact numbers and arcs", () => {
    expect(serializeSegments(parsePathData("m10 10h5v5z"))).toBe("M10 10 L15 10 L15 15 Z");
    expect(serializeSegments(parsePathData("M0 0L1.5.5-2 3"))).toBe("M0 0 L1.5 0.5 L-2 3");
    const arc = parsePathData("M0 0 a5 5 0 0 1 10 0");
    expect(arc.length).toBeGreaterThan(1);
    expect(arc.every((s) => s.type === "M" || s.type === "C")).toBe(true);
    expect(arc.at(-1)).toMatchObject({ p: { x: 10, y: 0 } });
    expect(() => parsePathData("L1 1")).toThrow(/start with M/);
    expect(() => parsePathData("M0 0 X")).toThrow(/unknown/);
  });

  test("parses colors and inline style", () => {
    expect(parseColor("#abc")).toBe("#aabbcc");
    expect(parseColor("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(parseColor("rgba(0,0,0,0.5)")).toBe("#00000080");
    expect(parseColor("hsl(120, 100%, 50%)")).toBe("#00ff00");
    expect(parseColor("tomato")).toBe("#ff6347");
    expect(parseColor("nonsense")).toBeNull();
    expect(parseStyleAttribute("fill: red; stroke-width:2 !important;")).toEqual({
      fill: "red",
      "stroke-width": "2",
    });
    expect(() => parseStyleAttribute("fill:url(https://x.test/a.svg#g)")).toThrow();
    expect(() => parseStyleAttribute("background:expression(alert(1))")).toThrow();
  });
});

describe("convertSvg", () => {
  test("wraps content in a clipped frame sized by the viewBox and scaled to width", () => {
    const { root, child } = first(
      wrap('<rect x="10" y="20" width="30" height="40" fill="#f00"/>'),
      {
        width: 200,
      },
    );
    expect(root).toMatchObject({ type: "frame", width: 200, height: 200, clip: true });
    expect(child).toMatchObject({
      type: "rectangle",
      x: 20,
      y: 40,
      width: 60,
      height: 80,
      fill: "#ff0000",
    });
  });

  test("respects viewBox origin and non-square aspect", () => {
    const { root, child } = first(
      wrap('<rect x="50" y="50" width="10" height="10"/>', 'viewBox="50 50 100 50"'),
      { width: 200 },
    );
    expect(root).toMatchObject({ width: 200, height: 100 });
    expect(child).toMatchObject({ x: 0, y: 0, width: 20, height: 20 });
  });

  test("uses svg width/height without a viewBox", () => {
    const { root } = first(wrap("", 'width="48" height="24"'));
    expect(root).toMatchObject({ width: 48, height: 24 });
  });

  test("rect rx becomes cornerRadius, stroke attributes map across", () => {
    const { child } = first(
      wrap(
        '<rect width="50" height="50" rx="8" fill="none" stroke="#00f" stroke-width="3" opacity="0.5"/>',
      ),
    );
    expect(child).toMatchObject({
      type: "rectangle",
      cornerRadius: 8,
      stroke: { color: "#0000ff", width: 3 },
      opacity: 0.5,
    });
    expect(child).not.toHaveProperty("fill");
  });

  test("circle and ellipse become ellipse nodes", () => {
    const { root } = first(
      wrap('<circle cx="50" cy="50" r="10"/><ellipse cx="20" cy="30" rx="10" ry="5"/>'),
    );
    expect(kids(root)[0]).toMatchObject({ type: "ellipse", x: 40, y: 40, width: 20, height: 20 });
    expect(kids(root)[1]).toMatchObject({ type: "ellipse", x: 10, y: 25, width: 20, height: 10 });
  });

  test("path, polygon, polyline and line become path nodes with local geometry", () => {
    const { root } = first(
      wrap(
        '<path d="M10 10 L30 10 L30 40 Z" fill="red"/><polygon points="0,0 10,0 10,10" fill="blue"/><polyline points="0,0 5,5" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="bevel"/><line x1="0" y1="0" x2="10" y2="0" stroke="#111"/>',
      ),
    );
    const [path, polygon, polyline, line] = kids(root);
    expect(path).toMatchObject({
      type: "path",
      x: 10,
      y: 10,
      width: 20,
      height: 30,
      geometry: "M0 0 L20 0 L20 30 Z",
    });
    expect(polygon).toMatchObject({ type: "path", geometry: "M0 0 L10 0 L10 10 Z" });
    expect(polyline).toMatchObject({ strokeCap: "round", strokeJoin: "bevel" });
    expect(line).not.toHaveProperty("fill");
    expect(line).toMatchObject({ stroke: { color: "#111111", width: 1 } });
  });

  test("applies translate and scale to coordinates, scales stroke width", () => {
    const { child } = first(
      wrap(
        '<g transform="translate(10 10) scale(2)"><rect width="5" height="5" stroke="#000" stroke-width="1"/></g>',
      ),
    );
    const rect = kids(child)[0] as RawNode;
    expect(child).toMatchObject({ type: "group" });
    expect(rect).toMatchObject({ x: 10, y: 10, width: 10, height: 10, stroke: { width: 2 } });
  });

  test("rotated rect becomes a path, rotated ellipse a path", () => {
    const { root } = first(
      wrap(
        '<rect width="10" height="10" transform="rotate(45)"/><circle r="5" transform="skewX(20)"/>',
      ),
    );
    expect(kids(root)[0]).toMatchObject({ type: "path" });
    expect(kids(root)[1]).toMatchObject({ type: "path" });
  });

  test("style attribute overrides presentation attributes; fill inherits from groups", () => {
    const { child } = first(
      wrap(
        '<g fill="#00ff00" fill-opacity="0.5"><rect width="10" height="10" style="fill:red;opacity:.4"/><rect width="5" height="5"/></g>',
      ),
    );
    const [a, b] = kids(child);
    // fill-opacity is inherited from the group, as in SVG.
    expect(a).toMatchObject({ fill: "#ff000080", opacity: 0.4 });
    expect(b).toMatchObject({ fill: "#00ff0080" });
  });

  test("text becomes a text node with approximate position and a warning", () => {
    const { child, warnings } = first(
      wrap(
        '<text x="10" y="50" font-size="20" font-family="Inter, sans-serif" font-weight="bold" fill="#111">Hello</text>',
      ),
    );
    expect(child).toMatchObject({
      type: "text",
      content: "Hello",
      fontSize: 20,
      fontFamily: "Inter",
      fontWeight: 700,
      x: 10,
      y: 34,
    });
    expect(warnings.join(" ")).toMatch(/approximate/);
  });

  test("use expands an internal reference with offset", () => {
    const { child } = first(
      wrap('<defs><circle id="dot" r="5" fill="red"/></defs><use href="#dot" x="20" y="30"/>'),
    );
    const dot = kids(child)[0] as RawNode;
    expect(dot).toMatchObject({ type: "ellipse", x: 15, y: 25, width: 10 });
  });

  test("nested svg maps its viewBox onto its x/y/width/height viewport", () => {
    const { child, warnings } = first(
      wrap(
        '<svg x="10" y="20" width="40" height="20" viewBox="5 5 10 10" preserveAspectRatio="none"><rect x="5" y="5" width="10" height="10"/></svg>',
      ),
    );
    expect(kids(child)[0]).toMatchObject({
      type: "rectangle",
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    });
    expect(warnings.join(" ")).not.toMatch(/nested/);
  });

  test("nested svg viewBox defaults to xMidYMid meet", () => {
    const { child } = first(
      wrap('<svg width="40" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
    );
    expect(kids(child)[0]).toMatchObject({ x: 10, y: 0, width: 20, height: 20 });
  });

  test("nested svg without a viewBox only moves its content", () => {
    const { child } = first(wrap('<svg x="7" y="3"><rect width="10" height="10"/></svg>'));
    expect(kids(child)[0]).toMatchObject({ x: 7, y: 3, width: 10, height: 10 });
  });

  const linear = (attrs: string, stops = BW, shape = '<rect width="100" height="100"') =>
    first(
      wrap(
        `<defs><linearGradient id="g" ${attrs}>${stops}</linearGradient></defs>${shape} fill="url(#g)"/>`,
      ),
    );
  const BW = '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>';

  test("linear gradients become linear fills with a CSS angle", () => {
    expect(linear("").child.fill).toEqual({
      type: "linear",
      angle: 90,
      stops: [
        { color: "#000000", position: 0 },
        { color: "#ffffff", position: 1 },
      ],
    });
    expect(linear('x2="0" y2="1"').child.fill).toMatchObject({ angle: 180 });
    expect(linear('x2="1" y2="1"').child.fill).toMatchObject({
      angle: 135,
      stops: [{ position: 0 }, { position: 1 }],
    });
    expect(linear("").warnings.join(" ")).not.toMatch(/gradient/);
  });

  test("a short gradient vector keeps the color padded to the ends", () => {
    expect(linear('x1="0.25" x2="0.75"').child.fill).toMatchObject({
      stops: [
        { color: "#000000", position: 0 },
        { color: "#000000", position: 0.25 },
        { color: "#ffffff", position: 0.75 },
        { color: "#ffffff", position: 1 },
      ],
    });
  });

  test("a gradient vector past the box is cut at the box edges", () => {
    expect(linear('x1="-1" x2="2"').child.fill).toMatchObject({
      stops: [
        { color: "#555555", position: 0 },
        { color: "#aaaaaa", position: 1 },
      ],
    });
  });

  test("userSpaceOnUse gradients follow the shape's position and transform", () => {
    const { child } = linear(
      'gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="30" y2="0"',
      BW,
      '<rect x="10" width="20" height="10" transform="translate(5 5)"',
    );
    expect(child).toMatchObject({ x: 15, y: 5 });
    expect(child.fill).toMatchObject({ angle: 90, stops: [{ position: 0 }, { position: 1 }] });
  });

  test("fill-opacity and stop-opacity fold into the stops; one stop is a solid color", () => {
    const { child } = linear(
      "",
      '<stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" style="stop-color:#fff"/>',
      '<rect width="10" height="10" fill-opacity="0.5"',
    );
    expect(child.fill).toMatchObject({
      stops: [
        { color: "#00000040", position: 0 },
        { color: "#ffffff80", position: 1 },
      ],
    });
    expect(linear("", '<stop offset="0.5" stop-color="#123456"/>').child.fill).toBe("#123456");
  });

  test("gradients inherit attributes and stops through href", () => {
    const { child } = first(
      wrap(
        `<defs><linearGradient id="base">${BW}</linearGradient><linearGradient id="g" href="#base" x2="0" y2="1"/></defs><rect width="10" height="10" fill="url(#g)"/>`,
      ),
    );
    expect(child.fill).toMatchObject({
      type: "linear",
      angle: 180,
      stops: [{ color: "#000000" }, { color: "#ffffff" }],
    });
  });

  test("radial gradients become radial fills, including the exporter's transform form", () => {
    const radial = (attrs: string, shape = '<rect width="100" height="50"') =>
      first(
        wrap(
          `<defs><radialGradient id="g" ${attrs}>${BW}</radialGradient></defs>${shape} fill="url(#g)"/>`,
        ),
      ).child.fill;
    expect(radial("")).toEqual({
      type: "radial",
      center: [0.5, 0.5],
      radius: [0.5, 0.5],
      stops: [
        { color: "#000000", position: 0 },
        { color: "#ffffff", position: 1 },
      ],
    });
    expect(
      radial(
        'gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(40 0 0 10 40 50)"',
        '<rect x="10" y="20" width="100" height="50"',
      ),
    ).toMatchObject({ center: [0.3, 0.6], radius: [0.4, 0.2] });
  });

  test("gradient fills survive an SVG export and import round trip", () => {
    const stops = [
      { color: "#4f46e5", position: 0 },
      { color: "#ec4899", position: 1 },
    ];
    const rect = (id: string, x: number, fill: unknown) =>
      ({ type: "rectangle", id, x, y: 30, width: 50, height: 40, fill }) as PegoNode;
    const root = {
      type: "frame",
      id: "f",
      width: 200,
      height: 100,
      children: [
        rect("a", 20, { type: "linear", angle: 30, stops }),
        rect("b", 120, { type: "radial", center: [0.3, 0.6], radius: [0.4, 0.2], stops }),
      ],
    } as PegoNode;
    const layout: Layout = new Map([
      ["f", { x: 0, y: 0, width: 200, height: 100 }],
      ["a", { x: 20, y: 30, width: 50, height: 40 }],
      ["b", { x: 120, y: 30, width: 50, height: 40 }],
    ]);
    const fills: Record<string, unknown>[] = [];
    const walk = (node: RawNode) => {
      const fill = node.fill as Record<string, unknown> | undefined;
      if (typeof fill === "object") fills.push(fill);
      ((node.children as RawNode[] | undefined) ?? []).forEach(walk);
    };
    walk(convertSvg(exportSvg(docWith(root), "f", { layout })).node);
    const [lin, rad] = fills;
    expect(lin).toMatchObject({ type: "linear", stops });
    expect(lin?.angle as number).toBeCloseTo(30, 1);
    expect(rad).toMatchObject({ type: "radial", center: [0.3, 0.6], radius: [0.4, 0.2], stops });
  });

  test("userSpaceOnUse percentages are of the viewport; defaults run across it", () => {
    const span = (attrs: string) =>
      first(
        wrap(
          `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${BW}</linearGradient></defs><rect width="200" height="10" fill="url(#g)"/>`,
          'viewBox="0 0 200 100"',
        ),
      ).child.fill;
    const full = { angle: 90, stops: [{ position: 0 }, { position: 1 }] };
    expect(span('x1="0%" x2="100%"')).toMatchObject(full);
    expect(span("")).toMatchObject(full);
  });

  test("a diagonal gradient on a non-square shape warns that it is approximate", () => {
    const warns = (shape: string, attrs = 'x2="1" y2="1"') =>
      linear(attrs, BW, shape).warnings.join(" ");
    expect(warns('<rect width="100" height="50"')).toMatch(/approximate/);
    expect(warns('<rect width="100" height="100"')).not.toMatch(/approximate/);
    expect(warns('<rect width="100" height="50"', 'x2="0" y2="1"')).not.toMatch(/approximate/);
  });

  test("currentColor stops and gradients without stops", () => {
    const { child } = linear(
      "",
      '<stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="#fff"/>',
      '<rect width="10" height="10" color="#ff0000"',
    );
    expect(child.fill).toMatchObject({ stops: [{ color: "#ff0000" }, { color: "#ffffff" }] });
    const empty = first(
      wrap(
        '<defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/><rect width="5" height="5" fill="red"/>',
      ),
    );
    expect(kids(empty.root)).toHaveLength(1);
    expect(empty.warnings.join(" ")).toMatch(/no stops/);
  });

  test("text and strokes still use the first stop, with a warning", () => {
    const { child, warnings } = first(
      wrap(
        `<defs><linearGradient id="g"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><text x="0" y="20" fill="url(#g)">Hi</text><rect width="10" height="10" fill="none" stroke="url(#g)"/>`,
      ),
    );
    expect(child).toMatchObject({ type: "text", fill: "#123456" });
    expect(warnings.join(" ")).toMatch(/gradient fills on text/);
    expect(warnings.join(" ")).toMatch(/used the first stop color/);
  });

  test("reports unsupported features and skips bad paths", () => {
    const { root, warnings } = first(
      wrap(
        '<style>.a{fill:red}</style><rect width="5" height="5" filter="url(#f)" stroke="#000" stroke-dasharray="2 2"/><path d="Mnope"/><switch/><marker/><blink/>',
      ),
    );
    expect(kids(root)).toHaveLength(1);
    const text = warnings.join("\n");
    expect(text).toMatch(/<style>/);
    expect(text).toMatch(/filter/);
    expect(text).toMatch(/stroke-dasharray/);
    expect(text).toMatch(/skipped/);
    expect(text).toMatch(/<blink>/);
  });

  test("skips display:none and empty groups", () => {
    const { root } = first(wrap('<g display="none"><rect width="5" height="5"/></g><g></g>'));
    expect(kids(root)).toHaveLength(0);
  });

  test("embedded data:image becomes an image node", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const { child } = first(wrap(`<image href="${png}" x="0" y="0" width="50" height="50"/>`));
    expect(child).toMatchObject({ type: "image", src: png, fit: "fit", width: 50 });
  });
});

describe("convertSvg safety", () => {
  test("rejects scripts, foreignObject and event attributes", () => {
    rejects(wrap("<script>alert(1)</script>"), "unsafe_svg");
    rejects(wrap("<foreignObject><div/></foreignObject>"), "unsafe_svg");
    rejects(wrap('<rect width="1" height="1" onclick="x()"/>'), "unsafe_svg");
    rejects(wrap('<rect width="1" height="1" onload="x()"/>'), "unsafe_svg");
    rejects(wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'), "unsafe_svg");
  });

  test("rejects external references and unsafe styles", () => {
    rejects(wrap('<image href="https://evil.test/a.png" width="1" height="1"/>'), "unsafe_svg");
    rejects(wrap('<use href="https://evil.test/a.svg#x"/>'), "unsafe_svg");
    rejects(
      wrap('<image href="data:image/svg+xml;base64,PHN2Zz4=" width="1" height="1"/>'),
      "unsafe_svg",
    );
    rejects(
      wrap('<rect width="1" height="1" style="fill:url(https://evil.test/x)"/>'),
      "unsafe_svg",
    );
    rejects(wrap("<style>@import url(https://evil.test/x.css);</style>"), "unsafe_svg");
  });

  test("rejects DTD entity bombs, bad roots, oversize and too many nodes", () => {
    rejects(`<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg viewBox="0 0 1 1">&a;</svg>`, "invalid_svg");
    rejects("<div/>", "invalid_svg");
    rejects("not xml", "invalid_svg");
    rejects(wrap(`<!-- ${"x".repeat(600 * 1024)} -->`), "svg_too_large");
    rejects(wrap('<rect width="1" height="1"/>'.repeat(2100)), "svg_too_complex");
  });

  test("use cycles terminate", () => {
    const { warnings } = first(wrap('<g id="a"><use href="#a"/><rect width="1" height="1"/></g>'));
    expect(warnings.join(" ")).toMatch(/nested too deeply/);
  });
});
