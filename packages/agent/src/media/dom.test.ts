import { describe, expect, test } from "bun:test";
import { nodeSchema } from "@pego/doc";
import type { DomBox, DomSnapshot, DomSnapshotNode, DomStyle } from "../browser-types";
import {
  convertDomSnapshot,
  MAX_DOM_NODES,
  parseBoxShadow,
  parseColor,
  parseLinearGradient,
  pickFontFamily,
} from "./dom";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const box = (x: number, y: number, width: number, height: number): DomBox => ({
  x,
  y,
  width,
  height,
});
const el = (
  tag: string,
  b: DomBox,
  style: DomStyle = {},
  children: DomSnapshotNode[] = [],
  component?: string,
): DomSnapshotNode => ({
  kind: "element",
  tag,
  box: b,
  style,
  children,
  ...(component ? { component } : {}),
});
const text = (t: string, b: DomBox, style: DomStyle = {}): DomSnapshotNode => ({
  kind: "text",
  text: t,
  box: b,
  style,
});
const snap = (root: DomSnapshotNode, title = "Home"): DomSnapshot => ({
  url: "https://example.com/",
  title,
  root,
});
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Give every node an id and run the document schema over the whole tree. */
const assertValid = (node: Json, n = { i: 0 }): void => {
  const withIds = (raw: Json): Json => ({
    ...raw,
    id: `n${n.i++}`,
    ...(raw.children ? { children: raw.children.map(withIds) } : {}),
  });
  const result = nodeSchema.safeParse(withIds(node));
  if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 3)));
};

describe("parseColor", () => {
  test("rgb, rgba, space syntax and alpha", () => {
    expect(parseColor("rgb(255, 0, 0)")?.hex).toBe("#ff0000");
    expect(parseColor("rgba(0, 0, 0, 0.5)")?.hex).toBe("#00000080");
    expect(parseColor("rgb(10 20 30 / 50%)")?.hex).toBe("#0a141e80");
    expect(parseColor("rgb(100% 0% 0%)")?.hex).toBe("#ff0000");
    expect(parseColor("color(srgb 1 0 0 / 0.5)")?.hex).toBe("#ff000080");
    expect(parseColor("color(srgb 0.2 0.4 0.6)")?.hex).toBe("#336699");
  });
  test("oklab and oklch", () => {
    expect(parseColor("oklab(1 0 0)")?.hex).toBe("#ffffff");
    expect(parseColor("oklch(0 0 0)")?.hex).toBe("#000000");
    expect(parseColor("oklch(0.62796 0.25768 29.234)")?.hex).toBe("#ff0000");
    expect(parseColor("oklch(62.8% 0.2577 29.23 / 50%)")?.hex).toBe("#ff000080");
    expect(parseColor("oklab(0.5 0.1 -0.1 / 0.5)")?.hex).toBe("#81459a80");
    expect(parseColor("oklch(0.7 0.15 none)")?.hex).toBe(parseColor("oklch(0.7 0.15 0)")?.hex);
    expect(parseColor("oklch(0.7 0.15 0.5turn)")?.hex).toBe(parseColor("oklch(0.7 0.15 180)")?.hex);
  });
  test("lab and lch", () => {
    expect(parseColor("lab(100 0 0)")?.hex).toBe("#ffffff");
    expect(parseColor("lab(0 0 0)")?.hex).toBe("#000000");
    expect(parseColor("lab(54.29 80.8 69.89)")?.hex).toBe("#ff0000");
    expect(parseColor("lch(54.29 106.84 40.85)")?.hex).toBe("#ff0000");
  });
  test("display-p3 and srgb-linear are converted and clamped", () => {
    expect(parseColor("color(display-p3 1 0 0)")?.hex).toBe("#ff0000");
    expect(parseColor("color(display-p3 1 1 1)")?.hex).toBe("#ffffff");
    expect(parseColor("color(display-p3 0 1 0 / 0.5)")?.hex).toBe("#00ff0080");
    expect(parseColor("color(srgb-linear 0.5 0.5 0.5)")?.hex).toBe("#bcbcbc");
    expect(parseColor("color(srgb-linear 1 0 0)")?.hex).toBe("#ff0000");
    expect(parseColor("color(rec2020 1 0 0)")).toBeNull();
    expect(parseColor("oklch(abc 0 0)")).toBeNull();
    expect(parseColor("lab(1 2)")).toBeNull();
  });
  test("hex, names and transparent", () => {
    expect(parseColor("#abc")?.hex).toBe("#aabbcc");
    expect(parseColor("#ABCD")?.hex).toBe("#aabbccdd");
    expect(parseColor("#FFAA00")?.hex).toBe("#ffaa00");
    expect(parseColor("#ffaa0080")?.hex).toBe("#ffaa0080");
    expect(parseColor("transparent")?.alpha).toBe(0);
    expect(parseColor("rgba(1,2,3,0)")?.alpha).toBe(0);
    expect(parseColor("white")?.hex).toBe("#ffffff");
  });
  test("garbage is null", () => {
    for (const bad of [
      undefined,
      "",
      "nope",
      "rgb(1,2)",
      "#12",
      "color(rec2020 1 0 0)",
      "rgb(a,b,c)",
    ]) {
      expect(parseColor(bad)).toBeNull();
    }
  });
});

describe("parseLinearGradient", () => {
  test("angle and explicit stops", () => {
    const g = parseLinearGradient(
      "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      100,
    );
    expect(g).toEqual({
      angle: 90,
      stops: [
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ],
    });
  });
  test("an interpolation clause is ignored", () => {
    const stops = [
      { color: "#ff0000", position: 0 },
      { color: "#0000ff", position: 1 },
    ];
    expect(parseLinearGradient("linear-gradient(in oklab, red, blue)", 100)).toEqual({
      angle: 180,
      stops,
    });
    expect(
      parseLinearGradient("linear-gradient(to right in oklch shorter hue, red, blue)", 100),
    ).toEqual({ angle: 90, stops });
    expect(parseLinearGradient("linear-gradient(45deg in srgb, red, blue)", 100)).toEqual({
      angle: 45,
      stops,
    });
    expect(parseLinearGradient("linear-gradient(in oklch longer hue, red, blue)", 100)?.angle).toBe(
      180,
    );
  });
  test("default direction, side keywords and distributed stops", () => {
    expect(
      parseLinearGradient("linear-gradient(red, white, blue)", 100)?.stops.map((s) => s.position),
    ).toEqual([0, 0.5, 1]);
    expect(parseLinearGradient("linear-gradient(red, blue)", 100)?.angle).toBe(180);
    expect(parseLinearGradient("linear-gradient(to right, red, blue)", 100)?.angle).toBe(90);
    expect(parseLinearGradient("linear-gradient(to top left, red, blue)", 100)?.angle).toBe(315);
    expect(parseLinearGradient("linear-gradient(0.25turn, red, blue)", 100)?.angle).toBe(90);
  });
  test("px positions and double positions", () => {
    const g = parseLinearGradient("linear-gradient(red 50px, blue 100px)", 200);
    expect(g?.stops.map((s) => s.position)).toEqual([0.25, 0.5]);
    expect(parseLinearGradient("linear-gradient(red 0% 50%, blue 50%)", 100)?.stops).toHaveLength(
      3,
    );
  });
  test("keeps transparent stops and rejects unsupported gradients", () => {
    expect(parseLinearGradient("linear-gradient(rgba(0,0,0,0), #000)", 10)?.stops[0]?.color).toBe(
      "#00000000",
    );
    expect(parseLinearGradient("radial-gradient(red, blue)", 10)).toBeNull();
    expect(parseLinearGradient("repeating-linear-gradient(red, blue)", 10)).toBeNull();
    expect(parseLinearGradient("linear-gradient(red)", 10)).toBeNull();
    expect(parseLinearGradient("linear-gradient(to nowhere, red, blue)", 10)).toBeNull();
  });
});

describe("parseBoxShadow", () => {
  test("browser serialization with color first", () => {
    const { shadows } = parseBoxShadow(
      "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px",
    );
    expect(shadows).toEqual([
      { type: "shadow", color: "#0000001a", x: 0, y: 4, blur: 6, spread: -1 },
      { type: "shadow", color: "#0000000f", x: 0, y: 2, blur: 4, spread: -1 },
    ]);
  });
  test("inset, color last, defaults and drops", () => {
    expect(parseBoxShadow("inset 0 1px 2px #000").shadows[0]).toMatchObject({
      inner: true,
      blur: 2,
      color: "#000000",
    });
    expect(parseBoxShadow("2px 2px red").shadows[0]).toMatchObject({
      x: 2,
      y: 2,
      blur: 0,
      color: "#ff0000",
    });
    expect(parseBoxShadow("none")).toEqual({ shadows: [], dropped: 0 });
    expect(parseBoxShadow("garbage 1px")).toMatchObject({ shadows: [], dropped: 1 });
    expect(parseBoxShadow("rgba(0,0,0,0) 1px 1px 1px").shadows).toEqual([]);
  });
});

test("pickFontFamily", () => {
  expect(pickFontFamily('"Helvetica Neue", Arial, sans-serif')).toBe("Helvetica Neue");
  expect(pickFontFamily("system-ui, sans-serif")).toBe("Inter");
  expect(pickFontFamily("-apple-system, BlinkMacSystemFont")).toBe("Inter");
  expect(pickFontFamily("'Playfair Display', serif")).toBe("Playfair Display");
  expect(pickFontFamily(undefined)).toBeUndefined();
});

describe("convertDomSnapshot root", () => {
  test("full page: frame named after the title, white fallback, clipped, at 0,0", () => {
    const r = convertDomSnapshot(
      snap(el("body", box(0, 0, 1280, 2000), {}, [text("Hello", box(40, 40, 100, 24))]), "My Site"),
    );
    expect(r.node).toMatchObject({
      type: "frame",
      name: "My Site",
      x: 0,
      y: 0,
      width: 1280,
      height: 2000,
      clip: true,
      // One text 40 px in: a vertical stack whose padding holds the offset.
      layout: "vertical",
      padding: [40, 0, 0, 40],
      fill: "#ffffff",
    });
    expect(r.count).toBe(2);
    expect(r.stats).toEqual({ autoLayout: 1, absolute: 0 });
    assertValid(r.node);
  });
  test("element root uses its background and component name, children are relative", () => {
    const r = convertDomSnapshot(
      snap(
        el(
          "section",
          box(100, 500, 300, 200),
          { backgroundColor: "rgb(10, 20, 30)" },
          [text("Title", box(120, 520, 80, 20))],
          "Hero",
        ),
      ),
    );
    expect(r.node).toMatchObject({
      name: "Hero - section",
      fill: "#0a141e",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(r.node).toMatchObject({ layout: "vertical", padding: [20, 0, 0, 20] });
    const child = (r.node.children as Json[])[0];
    expect(child).toMatchObject({ type: "text" });
    expect(child?.x).toBeUndefined();
  });
  test("no fill when element root has a transparent background", () => {
    const r = convertDomSnapshot(
      snap(el("div", box(0, 0, 10, 10), { backgroundColor: "rgba(0,0,0,0)" })),
    );
    expect(r.node.fill).toBeUndefined();
  });
  test("non-element roots are wrapped", () => {
    const r = convertDomSnapshot(
      snap({ kind: "image", tag: "img", src: PNG, box: box(5, 5, 50, 40), style: {} }),
    );
    expect(r.node).toMatchObject({ type: "frame", width: 50, height: 40 });
    expect((r.node.children as Json[])[0]).toMatchObject({ type: "image", x: 0, y: 0 });
    assertValid(r.node);
  });
});

describe("visuals", () => {
  const one = (style: DomStyle, b = box(0, 0, 100, 50)): Json => {
    const r = convertDomSnapshot(snap(el("div", box(0, 0, 400, 400), {}, [el("div", b, style)])));
    assertValid(r.node);
    return (r.node.children as Json[])[0] ?? {};
  };
  test("fill, radius, opacity, clip", () => {
    expect(
      one({ backgroundColor: "rgb(255,0,0)", borderRadius: 8, opacity: 0.5, overflowHidden: true }),
    ).toMatchObject({
      type: "frame",
      fill: "#ff0000",
      cornerRadius: 8,
      opacity: 0.5,
      clip: true,
      layout: "none",
      width: 100,
      height: 50,
    });
  });
  test("transparent-only elements without children are skipped", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), {}, [
          el("div", box(0, 0, 10, 10), { backgroundColor: "rgba(0,0,0,0)" }),
        ]),
      ),
    );
    expect(r.node.children).toEqual([]);
    expect(r.count).toBe(1);
  });
  test("gradient fill and warning when unparseable", () => {
    expect(one({ backgroundImage: "linear-gradient(to right, red, blue)" }).fill).toMatchObject({
      type: "linear",
      angle: 90,
    });
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 50, 50), {
          backgroundImage: "conic-gradient(red, blue)",
          backgroundColor: "#fff",
        }),
      ),
    );
    expect(r.warnings.some((w) => w.includes("unsupported background"))).toBe(true);
    expect(r.node.fill).toBe("#ffffff");
  });
  test("url() backgrounds: data image kept, others warned", () => {
    expect(one({ backgroundImage: `url("${PNG}")` }).fill).toEqual({
      type: "image",
      src: PNG,
      fit: "cover",
    });
    const r = convertDomSnapshot(
      snap(el("div", box(0, 0, 50, 50), { backgroundImage: 'url("https://x.test/a.png")' })),
    );
    expect(r.warnings.join()).toContain("background image skipped");
    expect(r.node.fill).toBeUndefined();
    const svg = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 50, 50), {
          backgroundImage: 'url("data:image/svg+xml;base64,PHN2Zz4=")',
        }),
      ),
    );
    expect(svg.warnings.join()).toContain("background image skipped");
  });
  test("stroke: uniform and per side", () => {
    expect(one({ borderWidth: [2, 2, 2, 2], borderColor: "rgb(0, 0, 0)" }).stroke).toEqual({
      color: "#000000",
      width: 2,
    });
    expect(one({ borderWidth: [0, 0, 1, 0], borderColor: "rgb(0, 0, 0)" }).stroke).toEqual({
      color: "#000000",
      width: [0, 0, 1, 0],
    });
    expect(
      one({ borderWidth: [0, 0, 0, 0], borderColor: "rgb(0, 0, 0)", backgroundColor: "#fff" })
        .stroke,
    ).toBeUndefined();
    expect(
      one({ borderWidth: [1, 1, 1, 1], borderColor: "transparent", backgroundColor: "#fff" })
        .stroke,
    ).toBeUndefined();
  });
  test("shadows become effects", () => {
    const node = one({
      boxShadow: "rgba(0, 0, 0, 0.2) 0px 2px 8px 0px, inset 0px 1px 0px rgb(255, 255, 255)",
    });
    expect(node.effects).toHaveLength(2);
    expect(node.effects[1]).toMatchObject({ inner: true, color: "#ffffff" });
  });
});

describe("text", () => {
  const textNode = (style: DomStyle, content = "Hello world", b = box(10, 20, 120.4, 40)): Json => {
    const r = convertDomSnapshot(
      snap(el("div", box(0, 0, 400, 400), {}, [text(content, b, style)])),
    );
    assertValid(r.node);
    return (r.node.children as Json[])[0] ?? {};
  };
  test("maps font props, line height multiple, fixed width", () => {
    expect(
      textNode({
        color: "rgb(17, 24, 39)",
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 16,
        fontWeight: 600,
        fontStyle: "italic",
        lineHeight: 24,
        letterSpacing: 0.5,
        textAlign: "center",
      }),
    ).toMatchObject({
      type: "text",
      name: "Hello world",
      width: 121,
      content: "Hello world",
      fontFamily: "Inter",
      fontSize: 16,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.5,
      letterSpacing: 0.5,
      textAlign: "center",
      fill: "#111827",
    });
  });
  test("line height rounds to 2 decimals; align mapping", () => {
    expect(textNode({ fontSize: 15, lineHeight: 20 }).lineHeight).toBe(1.33);
    expect(textNode({ textAlign: "justify" }).textAlign).toBe("left");
    expect(textNode({ textAlign: "end" }).textAlign).toBe("right");
    expect(textNode({}).textAlign).toBeUndefined();
  });
  test("text transform and long names", () => {
    expect(textNode({ textTransform: "uppercase" }, "buy now").content).toBe("BUY NOW");
    expect(textNode({ textTransform: "lowercase" }, "BUY NOW").content).toBe("buy now");
    expect(textNode({ textTransform: "capitalize" }, "buy now-or later").content).toBe(
      "Buy Now-Or Later",
    );
    expect((textNode({}, "x".repeat(100)).name as string).length).toBeLessThanOrEqual(33);
  });
  test("empty text is skipped", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), { backgroundColor: "#fff" }, [
          text("   ", box(0, 0, 10, 10)),
        ]),
      ),
    );
    expect(r.node.children).toEqual([]);
  });
});

describe("flattening", () => {
  test("a wrapper with one same-box child is removed, offsets stay right", () => {
    const inner = el("div", box(50, 60, 100, 40), { backgroundColor: "#ff0000" });
    const wrapper = el("div", box(50, 60, 100, 40), {}, [inner]);
    const r = convertDomSnapshot(
      snap(el("div", box(0, 0, 300, 300), {}, [el("div", box(50, 60, 100, 40), {}, [wrapper])])),
    );
    const kids = r.node.children as Json[];
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ width: 100, height: 40, fill: "#ff0000", children: [] });
    expect(r.node).toMatchObject({ layout: "vertical", padding: [60, 0, 0, 50] });
    expect(r.count).toBe(2);
  });
  test("wrappers with visuals, other boxes or several children stay", () => {
    const leaf = text("a", box(10, 10, 20, 10));
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 300, 300), {}, [
          el("div", box(0, 0, 100, 100), { backgroundColor: "#eee" }, [
            el("p", box(0, 0, 100, 100), {}, [leaf]),
          ]),
          el("div", box(0, 120, 100, 100), {}, [leaf]),
          el("div", box(0, 240, 100, 50), {}, [leaf, leaf]),
        ]),
      ),
    );
    const kids = r.node.children as Json[];
    expect(kids).toHaveLength(3);
    expect(kids[0]?.type).toBe("frame");
    expect(kids[1]?.type).toBe("frame");
    expect(kids[2]?.children).toHaveLength(2);
  });
  test("a wrapper with opacity below 1 is kept", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), {}, [
          el("div", box(0, 0, 100, 100), { opacity: 0.5 }, [
            el("div", box(0, 0, 100, 100), { backgroundColor: "#ff0000" }),
          ]),
        ]),
      ),
    );
    const kid = (r.node.children as Json[])[0];
    expect(kid).toMatchObject({ type: "frame", opacity: 0.5 });
    expect(kid?.children).toHaveLength(1);
  });
  test("collapsing deep same-box wrappers respects the depth limit", () => {
    let node: DomSnapshotNode = el("div", box(0, 0, 10, 10), { backgroundColor: "#ff0000" });
    for (let i = 0; i < 300; i++) node = el("div", box(0, 0, 10, 10), {}, [node]);
    const r = convertDomSnapshot(snap(node));
    expect(r.warnings.some((w) => w.includes("nesting deeper"))).toBe(true);
  });
  test("overflow hidden wrappers are kept", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), {}, [
          el("div", box(0, 0, 100, 100), { overflowHidden: true }, [text("a", box(0, 0, 10, 10))]),
        ]),
      ),
    );
    expect((r.node.children as Json[])[0]).toMatchObject({ clip: true });
  });
});

describe("images", () => {
  const image = (
    src: string,
    style: DomStyle & { objectFit?: string } = {},
    alt?: string,
  ): DomSnapshotNode => ({
    kind: "image",
    tag: "img",
    src,
    alt,
    box: box(10, 10, 80, 60),
    style,
  });
  test("data and https images, fit, radius, alt", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 200, 200), {}, [
          image(PNG, { objectFit: "cover", borderRadius: 4 } as DomStyle, "A photo"),
          image("https://example.com/a.png", { objectFit: "contain" } as DomStyle),
          image("https://example.com/b.png"),
        ]),
      ),
    );
    const [a, b, c] = r.node.children as Json[];
    expect(a).toMatchObject({
      type: "image",
      src: PNG,
      fit: "crop",
      cornerRadius: 4,
      alt: "A photo",
      width: 80,
      height: 60,
    });
    expect(b?.fit).toBe("fit");
    expect(c?.fit).toBe("fill");
    assertValid(r.node);
  });
  test("bad sources are skipped with a warning", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), {}, [
          image("http://x.test/a.png"),
          image("blob:abc"),
          image("data:image/svg+xml;base64,PHN2Zz4="),
          image(""),
        ]),
      ),
    );
    expect(r.node.children).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("svg", () => {
  const svg = (markup: string, b = box(10, 10, 48, 48)): DomSnapshotNode => ({
    kind: "svg",
    markup,
    box: b,
    style: {},
  });
  const MARK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0E7C5A"/></svg>';
  test("fits the svg into the box", () => {
    const r = convertDomSnapshot(snap(el("div", box(0, 0, 100, 100), {}, [svg(MARK)])));
    const [node] = r.node.children as Json[];
    expect(node).toMatchObject({ type: "frame", width: 48, height: 48 });
    expect(r.node).toMatchObject({ padding: [10, 0, 0, 10] });
    expect(r.count).toBeGreaterThan(2);
    assertValid(r.node);
  });
  test("keeps aspect ratio and centers in a taller box", () => {
    const wide = '<svg viewBox="0 0 40 10"><rect width="40" height="10" fill="#000"/></svg>';
    const r = convertDomSnapshot(
      snap(el("div", box(0, 0, 100, 100), {}, [svg(wide, box(0, 0, 40, 40))])),
    );
    expect((r.node.children as Json[])[0]).toMatchObject({ width: 40, height: 10 });
    expect(r.node).toMatchObject({ layout: "vertical", padding: [15, 0, 0, 0] });
  });
  test("a failing svg warns and is skipped", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), {}, [
          svg("<svg><script>alert(1)</script></svg>"),
          svg("not xml"),
        ]),
      ),
    );
    expect(r.node.children).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith("svg skipped")).length).toBe(2);
  });
});

describe("caps and odd input", () => {
  test("caps the node count with one warning", () => {
    const kids = Array.from({ length: 50 }, (_, i) => text(`t${i}`, box(0, i * 10, 50, 10)));
    const r = convertDomSnapshot(snap(el("div", box(0, 0, 100, 600), {}, kids)), { maxNodes: 20 });
    expect(r.count).toBe(20);
    expect((r.node.children as Json[]).length).toBe(19);
    expect(r.warnings.filter((w) => w.includes("node limit"))).toHaveLength(1);
  });
  test("default cap constant", () => {
    expect(MAX_DOM_NODES).toBe(2500);
  });
  test("deep nesting does not blow the stack", () => {
    let node: DomSnapshotNode = text("deep", box(0, 0, 10, 10));
    for (let i = 0; i < 500; i++)
      node = el("div", box(0, 0, 100 + (i % 2), 100), { backgroundColor: "#fff" }, [node]);
    const r = convertDomSnapshot(snap(node));
    expect(r.warnings.join()).toContain("deeper");
  });
  test("zero or NaN boxes and unknown kinds are ignored", () => {
    const weird = [
      el("div", box(0, 0, 0, 10), { backgroundColor: "#fff" }),
      el("div", box(Number.NaN, 0, 10, 10), { backgroundColor: "#fff" }),
      { kind: "mystery" } as unknown as DomSnapshotNode,
      null as unknown as DomSnapshotNode,
      text("x", box(0, 0, 0, 0)),
    ];
    const r = convertDomSnapshot(snap(el("div", box(0, 0, 100, 100), {}, weird)));
    expect(r.node.children).toEqual([]);
  });
  test("broken snapshots do not throw", () => {
    expect(convertDomSnapshot({} as DomSnapshot).warnings.length).toBe(1);
    expect(convertDomSnapshot(snap(el("div", box(0, 0, 0, 0)))).count).toBe(0);
    const r = convertDomSnapshot(
      snap(
        el(
          "div",
          box(0, 0, 100, 100),
          {
            fontSize: Number.NaN,
            borderWidth: [1, 2] as unknown as [number, number, number, number],
            boxShadow: "((",
            backgroundColor: "lol",
          },
          [
            text("hi", box(0, 0, 10, 10), {
              fontSize: -4,
              lineHeight: Number.NaN,
              fontWeight: "bold" as unknown as number,
            }),
          ],
        ),
      ),
    );
    assertValid(r.node);
  });
  test("invalid props are dropped with a warning, not a failure", () => {
    const r = convertDomSnapshot(
      snap(
        el("div", box(0, 0, 100, 100), { backgroundColor: "#fff" }, [
          text("hi", box(0, 0, 10, 10), { fontWeight: "bold" as unknown as number }),
        ]),
      ),
    );
    const t = (r.node.children as Json[])[0];
    expect(t?.type).toBe("text");
    expect(t?.fontWeight).toBeUndefined();
  });
});

describe("text width", () => {
  const textStyle: DomStyle = { fontSize: 16, lineHeight: 24, color: "rgb(0, 0, 0)" };
  const convertOne = (t: DomSnapshotNode) => {
    const { node } = convertDomSnapshot(snap(el("div", box(0, 0, 400, 200), {}, [t])));
    return (node as Json).children[0] as Json;
  };

  test("a single line measures itself (no fixed width)", () => {
    const node = convertOne(text("Class Warfare", box(10, 10, 120, 24), textStyle));
    expect(node.type).toBe("text");
    expect(node.width).toBeUndefined();
  });

  test("several lines keep the box width so wrapping matches", () => {
    const node = convertOne(text("A long paragraph that wraps", box(10, 10, 120, 72), textStyle));
    expect(node.width).toBe(120);
  });
});
