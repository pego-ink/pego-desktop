import { describe, expect, test } from "bun:test";
import type { DomSnapshot, DomSnapshotNode, DomStyle } from "../browser-types";
import { convertDomSnapshot, parseRadialGradient } from "./dom";
import {
  assertValid,
  box,
  domBoxesByName,
  el,
  layoutByName,
  snap,
  syntheticPage,
  text,
  textName,
  type Json,
} from "./dom-test-fixtures";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const BG: DomStyle = { backgroundColor: "rgb(200, 200, 200)" };
const T: DomStyle = { fontSize: 14, lineHeight: 20, color: "rgb(0, 0, 0)" };

/** A leaf box with a background, named `${name} - div`. */
const leaf = (name: string, x: number, y: number, w: number, h: number, style: DomStyle = {}) =>
  el("div", box(x, y, w, h), { ...BG, ...style }, [], name);

/** A button: padding 10/16 around a 20 px label. */
const btn = (label: string, x: number, y: number, w: number) =>
  el(
    "a",
    box(x, y, w, 40),
    { ...BG, padding: [10, 16, 10, 16] },
    [text(label, box(x + 16, y + 10, w - 32, 20), T, true)],
    label,
  );

const convert = (root: DomSnapshotNode | DomSnapshot) => {
  const s = "kind" in root ? snap(root) : root;
  const r = convertDomSnapshot(s);
  assertValid(r.node);
  return { ...r, node: r.node as Json, kids: (r.node.children ?? []) as Json[], snapshot: s };
};

/** Every element and text of the snapshot lands where the page had it (Pego's own layout). */
const expectFaithful = (s: ReturnType<typeof convert>) => {
  const got = layoutByName(s.snapshot, s.node);
  const textNames = new Set<string>();
  const walk = (n: DomSnapshotNode) => {
    if (n.kind === "text") textNames.add(textName(n.text));
    if (n.kind === "element") n.children.forEach(walk);
  };
  walk(s.snapshot.root);
  for (const [name, want] of domBoxesByName(s.snapshot)) {
    const b = got.get(name);
    expect({ name, found: !!b }).toEqual({ name, found: true });
    if (!b) continue;
    expect(Math.abs(b.y - want.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.height - want.height)).toBeLessThanOrEqual(2);
    if (textNames.has(name) && b.width > want.width + 2) continue; // a fill/fixed text width
    expect({ name, dx: Math.round(Math.abs(b.x - want.x)) }).toEqual({ name, dx: 0 });
    expect(Math.abs(b.width - want.width)).toBeLessThanOrEqual(2);
  }
};

describe("flex containers", () => {
  test("a row with gap, padding and centered items; buttons hug their labels", () => {
    const r = convert(
      el(
        "div",
        box(0, 0, 400, 64),
        {
          display: "flex",
          columnGap: 16,
          gap: 16,
          padding: [12, 12, 12, 12],
          alignItems: "center",
        },
        [btn("Alpha", 12, 12, 80), btn("Beta", 108, 12, 90), btn("Gamma", 214, 12, 70)],
      ),
    );
    expect(r.node).toMatchObject({
      layout: "horizontal",
      gap: 16,
      padding: 12,
      alignItems: "center",
      width: 400,
    });
    expect(r.node.height).toBeUndefined(); // hugs: 12 + 40 + 12
    for (const kid of r.kids) {
      expect(kid).toMatchObject({ type: "frame", layout: "vertical", padding: [10, 16, 10, 16] });
      expect(kid.width).toBeUndefined();
      expect(kid.height).toBeUndefined();
      expect(kid.x).toBeUndefined();
    }
    expect(r.stats).toEqual({ autoLayout: 4, absolute: 0 });
    expectFaithful(r);
  });

  test("a column centered on the cross axis", () => {
    const r = convert(
      el(
        "div",
        box(0, 0, 300, 200),
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          rowGap: 10,
          gap: 10,
          padding: [20, 0, 20, 0],
        },
        [leaf("X", 110, 20, 80, 40), leaf("Y", 75, 70, 150, 40), leaf("Z", 125, 120, 50, 40)],
      ),
    );
    expect(r.node).toMatchObject({
      layout: "vertical",
      alignItems: "center",
      gap: 10,
      padding: [20, 0, 20, 0],
      height: 200, // the page made it taller than its content: fixed
    });
    expectFaithful(r);
  });

  test("row-reverse: children in visual order, flex-start packs at the end", () => {
    const r = convert(
      el("div", box(0, 0, 300, 40), { display: "flex", flexDirection: "row-reverse" }, [
        leaf("A", 250, 0, 50, 40),
        leaf("B", 200, 0, 50, 40),
        leaf("C", 150, 0, 50, 40),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "horizontal", justifyContent: "end" });
    expect(r.kids.map((k) => k.name)).toEqual(["C - div", "B - div", "A - div"]);
    expectFaithful(r);
  });

  test("column-reverse stacks bottom-up", () => {
    const r = convert(
      el("div", box(0, 0, 100, 100), { display: "flex", flexDirection: "column-reverse" }, [
        leaf("A", 0, 60, 100, 40),
        leaf("B", 0, 20, 100, 40),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "vertical", justifyContent: "end" });
    expect(r.kids.map((k) => k.name)).toEqual(["B - div", "A - div"]);
    expectFaithful(r);
  });

  test("padding includes border widths", () => {
    const r = convert(
      el(
        "div",
        box(0, 0, 200, 50),
        {
          display: "flex",
          padding: [10, 20, 10, 20],
          borderWidth: [2, 2, 2, 2],
          borderColor: "rgb(0, 0, 0)",
        },
        [leaf("A", 22, 12, 60, 26)],
      ),
    );
    expect(r.node).toMatchObject({
      layout: "horizontal",
      padding: [12, 22, 12, 22],
      stroke: { color: "#000000", width: 2 },
    });
    expectFaithful(r);
  });

  const justified = (justifyContent: string, xs: number[]) =>
    convert(
      el(
        "div",
        box(0, 0, 400, 50),
        { display: "flex", justifyContent },
        xs.map((x, i) => leaf(`J${i}`, x, 0, 50, 50)),
      ),
    );

  test.each([
    ["space-between", [0, 175, 350], "space_between"],
    ["center", [125, 175, 225], "center"],
    ["flex-end", [250, 300, 350], "end"],
    ["end", [250, 300, 350], "end"],
    ["space-around", [41.67, 175, 308.33], "space_around"],
  ])("justify-content %s maps to %s", (css, xs, pego) => {
    const r = justified(css, xs);
    expect(r.node).toMatchObject({ layout: "horizontal", justifyContent: pego });
    expectFaithful(r);
  });

  test("space-evenly keeps the observed spacing", () => {
    const r = justified("space-evenly", [62.5, 175, 287.5]);
    expect(r.node).toMatchObject({ layout: "horizontal", gap: 62.5, padding: [0, 0, 0, 62.5] });
    expect(r.node.justifyContent).toBeUndefined();
    expectFaithful(r);
  });

  test("stretch: items spanning the cross axis fill it; align-self opts out", () => {
    const r = convert(
      el("div", box(0, 0, 300, 80), { display: "flex", padding: [10, 10, 10, 10] }, [
        leaf("A", 10, 10, 100, 60),
        leaf("B", 120, 10, 100, 60),
        leaf("C", 230, 10, 60, 30, { alignSelf: "flex-start" }),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "horizontal", gap: 10 });
    expect(r.kids.map((k) => k.height)).toEqual(["fill_container", "fill_container", 30]);
    expectFaithful(r);
  });

  test("flex-grow items fill the main axis", () => {
    const r = convert(
      el("div", box(0, 0, 300, 40), { display: "flex", columnGap: 10, gap: 10 }, [
        leaf("A", 0, 0, 60, 40),
        leaf("B", 70, 0, 230, 40, { flexGrow: 1 }),
      ]),
    );
    expect(r.kids.map((k) => k.width)).toEqual([60, "fill_container"]);
    expectFaithful(r);
  });

  test("a wrapped flex row stays absolute", () => {
    const r = convert(
      el("div", box(0, 0, 200, 100), { display: "flex", flexWrap: "wrap" }, [
        leaf("A", 0, 0, 120, 50),
        leaf("B", 0, 50, 120, 50),
      ]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids[1]).toMatchObject({ x: 0, y: 50 });
  });
});

describe("block flow", () => {
  test("uniform spacing from margins becomes the gap; last margin folds into padding", () => {
    const r = convert(
      el("div", box(0, 0, 200, 150), { display: "block" }, [
        leaf("P1", 0, 0, 200, 30, { margin: [0, 0, 20, 0] }),
        leaf("P2", 0, 50, 200, 30, { margin: [0, 0, 20, 0] }),
        leaf("P3", 0, 100, 200, 30, { margin: [0, 0, 20, 0] }),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "vertical", gap: 20, padding: [0, 0, 20, 0] });
    expect(r.node.height).toBeUndefined();
    expect(r.kids.map((k) => [k.width, k.height])).toEqual([
      ["fill_container", 30],
      ["fill_container", 30],
      ["fill_container", 30],
    ]);
    expectFaithful(r);
  });

  test("varying spacing keeps the container absolute", () => {
    const r = convert(
      el("div", box(0, 0, 200, 150), { display: "block" }, [
        leaf("P1", 0, 0, 200, 30),
        leaf("P2", 0, 50, 200, 30),
        leaf("P3", 0, 90, 200, 30),
      ]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids.map((k) => k.y)).toEqual([0, 50, 90]);
    expect(r.stats).toEqual({ autoLayout: 0, absolute: 1 });
  });

  test("inline-blocks sharing a line become a row", () => {
    const r = convert(
      el("p", box(0, 0, 300, 30), { display: "block" }, [
        el("span", box(0, 0, 60, 30), { ...BG, display: "inline-block" }, [], "S1"),
        el("span", box(64, 0, 80, 30), { ...BG, display: "inline-block" }, [], "S2"),
        el("span", box(148, 0, 40, 30), { ...BG, display: "inline-block" }, [], "S3"),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "horizontal", gap: 4 });
    expectFaithful(r);
  });

  test("a single-column grid is a vertical stack", () => {
    const r = convert(
      el("div", box(0, 0, 200, 110), { display: "grid", rowGap: 10 }, [
        leaf("G1", 0, 0, 200, 50),
        leaf("G2", 0, 60, 200, 50),
      ]),
    );
    expect(r.node).toMatchObject({ layout: "vertical", gap: 10 });
  });
});

describe("absolute fallback", () => {
  test("an absolutely positioned child forces layout none", () => {
    const r = convert(
      el("div", box(0, 0, 200, 100), { display: "block" }, [
        leaf("A", 0, 0, 200, 40),
        leaf("B", 0, 40, 200, 40),
        leaf("Badge", 180, -10, 20, 20, { position: "absolute" }),
      ]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids[2]).toMatchObject({ x: 180, y: -10, width: 20, height: 20 });
  });

  test.each([
    ["fixed", { position: "fixed" }],
    ["sticky", { position: "sticky" }],
    ["float", { float: "left" }],
    ["transform", { transformed: true }],
  ] as [string, DomStyle][])("a %s child forces layout none", (_, style) => {
    const r = convert(
      el("div", box(0, 0, 200, 80), {}, [
        leaf("A", 0, 0, 200, 40, style),
        leaf("B", 0, 40, 200, 40),
      ]),
    );
    expect(r.node.layout).toBe("none");
  });

  test("a collapsed wrapper keeps its out-of-flow position", () => {
    const r = convert(
      el("div", box(0, 0, 200, 80), {}, [
        el("div", box(0, 0, 200, 40), { position: "absolute" }, [leaf("A", 0, 0, 200, 40)]),
        leaf("B", 0, 40, 200, 40),
      ]),
    );
    expect(r.kids).toHaveLength(2);
    expect(r.node.layout).toBe("none");
  });

  test("overlapping children force layout none", () => {
    const r = convert(
      el("div", box(0, 0, 200, 100), {}, [leaf("A", 0, 0, 100, 50), leaf("B", 50, 25, 100, 50)]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids.map((k) => [k.x, k.y])).toEqual([
      [0, 0],
      [50, 25],
    ]);
  });

  test("verification: a CSS layout Pego would misplace falls back to absolute", () => {
    // space-between, but the last item is pushed right (margin-left: auto on it in the page):
    // Pego's space_between would center the middle item, so the stack is rejected.
    const r = convert(
      el("div", box(0, 0, 400, 50), { display: "flex", justifyContent: "space-between" }, [
        leaf("A", 0, 0, 50, 50),
        leaf("B", 60, 0, 50, 50),
        leaf("C", 350, 0, 50, 50),
      ]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids.map((k) => k.x)).toEqual([0, 60, 350]);
    expect(r.stats).toEqual({ autoLayout: 0, absolute: 1 });
  });

  test("verification: unequal flex-grow shares fall back to fixed widths", () => {
    const r = convert(
      el("div", box(0, 0, 300, 40), { display: "flex" }, [
        leaf("A", 0, 0, 100, 40, { flexGrow: 1 }),
        leaf("B", 100, 0, 200, 40, { flexGrow: 2 }),
      ]),
    );
    expect(r.node.layout).toBe("horizontal");
    expect(r.kids.map((k) => k.width)).toEqual([100, 200]);
    expectFaithful(r);
  });

  test("only the failing container falls back; its children keep their own stacks", () => {
    const card = (name: string, x: number, y: number) =>
      el(
        "div",
        box(x, y, 100, 60),
        { ...BG, padding: [10, 10, 10, 10] },
        [
          text(`${name} title`, box(x + 10, y + 10, 50, 20), T, true),
          text(`${name} body`, box(x + 10, y + 30, 60, 20), T, true),
        ],
        name,
      );
    const r = convert(el("div", box(0, 0, 300, 200), {}, [card("K1", 0, 0), card("K2", 40, 30)]));
    expect(r.node.layout).toBe("none");
    expect(r.kids.map((k) => k.layout)).toEqual(["vertical", "vertical"]);
    expect(r.stats).toEqual({ autoLayout: 2, absolute: 1 });
    expectFaithful(r);
  });

  test("children of absolute containers that hug keep fit_content", () => {
    const r = convert(
      el("div", box(0, 0, 300, 200), {}, [btn("One", 0, 0, 80), btn("Two", 40, 20, 80)]),
    );
    expect(r.node.layout).toBe("none");
    expect(r.kids[1]).toMatchObject({ x: 40, y: 20 });
    expect(r.kids[1]?.width).toBeUndefined();
  });
});

describe("text in stacks", () => {
  const article = () =>
    convert(
      el("article", box(0, 0, 600, 400), { display: "block" }, [
        text("Title", box(0, 0, 120, 32), { fontSize: 24, lineHeight: 32 }, true),
        text(
          "A long paragraph that wraps over three lines of the article column",
          box(0, 48, 590, 72),
          { fontSize: 16, lineHeight: 24 },
          true,
        ),
        text(
          "A narrow paragraph with a max width",
          box(0, 136, 300, 48),
          { fontSize: 16, lineHeight: 24 },
          true,
        ),
        text(
          "Centered",
          box(260, 200, 80, 24),
          { fontSize: 16, lineHeight: 24, textAlign: "center" },
          true,
        ),
      ]),
    );

  test("paragraph widths: single line measures itself, spanning text fills, narrow text is fixed", () => {
    const r = article();
    expect(r.node).toMatchObject({ layout: "vertical", gap: 16, height: 400 });
    const [title, long, narrow, centered] = r.kids;
    expect(title?.width).toBeUndefined();
    expect(long?.width).toBe("fill_container");
    expect(narrow?.width).toBe(300);
    expect(centered).toMatchObject({ width: "fill_container", textAlign: "center" });
    expectFaithful(r);
  });

  test("nowrap and pre text never gets a width", () => {
    const r = convert(
      el("div", box(0, 0, 300, 100), {}, [
        text("line one\nline two", box(0, 0, 80, 48), {
          fontSize: 16,
          lineHeight: 24,
          whiteSpace: "pre",
        }),
        text("a long label", box(0, 60, 300, 40), {
          fontSize: 16,
          lineHeight: 20,
          whiteSpace: "nowrap",
        }),
      ]),
    );
    expect(r.kids.map((k) => k.width)).toEqual([undefined, undefined]);
  });

  test("multi-line text in a row is fixed, or fills when it grows", () => {
    const r = convert(
      el("div", box(0, 0, 400, 48), { display: "flex", columnGap: 20, gap: 20 }, [
        leaf("Icon", 0, 0, 48, 48),
        text("Two lines of text next to an icon", box(68, 0, 332, 48), { ...T, lineHeight: 24 }),
      ]),
    );
    expect(r.kids[1]?.width).toBe(332);
    const grown = convert(
      el("div", box(0, 0, 400, 48), { display: "flex", columnGap: 20, gap: 20 }, [
        leaf("Icon", 0, 0, 48, 48),
        el("div", box(68, 0, 332, 48), { flexGrow: 1 }, [
          text("Two lines of text that grow", box(68, 0, 330, 48), { ...T, lineHeight: 24 }),
        ]),
      ]),
    );
    expect(grown.kids[1]?.width).toBe("fill_container");
    expectFaithful(grown);
  });
});

describe("merged paragraphs carry their block's flow facts", () => {
  test("flex-grow on a paragraph fills the row; a floated one forces absolute", () => {
    const row = convert(
      el("div", box(0, 0, 400, 48), { display: "flex" }, [
        el("div", box(0, 0, 48, 48), BG, [], "Icon"),
        text(
          "Grows to the end of the row, two lines",
          box(48, 0, 352, 48),
          {
            ...T,
            lineHeight: 24,
            flexGrow: 1,
          },
          true,
        ),
      ]),
    );
    expect(row.kids[1]?.width).toBe("fill_container");
    const floated = convert(
      el("div", box(0, 0, 400, 100), {}, [
        text("Floated", box(0, 0, 60, 20), { ...T, float: "left" }, true),
        text("Beside", box(70, 0, 60, 20), T, true),
      ]),
    );
    expect(floated.node.layout).toBe("none");
  });
});

describe("radial gradients", () => {
  test("default shape: ellipse, farthest-corner, centered", () => {
    expect(parseRadialGradient("radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))", 100, 50)).toEqual(
      {
        center: [0.5, 0.5],
        radius: [0.7071, 0.7071],
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      },
    );
  });
  test("circle, size keywords, explicit sizes and positions", () => {
    expect(
      parseRadialGradient("radial-gradient(circle at 0% 0%, red, blue)", 100, 50),
    ).toMatchObject({ center: [0, 0], radius: [1.118, 2.2361] });
    expect(
      parseRadialGradient("radial-gradient(closest-side at 25% 50%, red, blue)", 100, 50),
    ).toMatchObject({ center: [0.25, 0.5], radius: [0.25, 0.5] });
    expect(
      parseRadialGradient("radial-gradient(circle closest-side, red 0%, blue 50%)", 100, 50),
    ).toMatchObject({ radius: [0.25, 0.5], stops: [{ position: 0 }, { position: 0.5 }] });
    expect(
      parseRadialGradient("radial-gradient(40px 20px at right top, red, blue)", 100, 50),
    ).toMatchObject({ center: [1, 0], radius: [0.4, 0.4] });
    expect(
      parseRadialGradient("radial-gradient(circle 10px at 20px 30px, red 5px, blue)", 100, 50),
    ).toMatchObject({ center: [0.2, 0.6], radius: [0.1, 0.2], stops: [{ position: 0.5 }, {}] });
    expect(
      parseRadialGradient("radial-gradient(ellipse farthest-side at top, red, blue)", 100, 50),
    ).toMatchObject({ center: [0.5, 0], radius: [0.5, 1] });
    expect(
      parseRadialGradient(
        "radial-gradient(circle farthest-corner at center in oklch, red, blue)",
        100,
        50,
      )?.radius[0],
    ).toBeCloseTo(Math.hypot(50, 25) / 100, 3);
    expect(parseRadialGradient("radial-gradient(in oklab, red, blue)", 100, 50)?.center).toEqual([
      0.5, 0.5,
    ]);
  });
  test("unreadable radial gradients are null", () => {
    for (const bad of [
      "repeating-radial-gradient(red, blue)",
      "radial-gradient(red)",
      "radial-gradient(foo at center, red, blue)",
      "radial-gradient(at left 10px top 5px, red, blue)",
      "linear-gradient(red, blue)",
    ]) {
      expect(parseRadialGradient(bad, 100, 50)).toBeNull();
    }
  });
  test("becomes a radial fill on the frame", () => {
    const r = convert(
      el("div", box(0, 0, 200, 100), {
        backgroundImage:
          "radial-gradient(circle at 50% 50%, rgb(255, 255, 255) 0%, rgba(0, 0, 0, 0) 100%)",
      }),
    );
    expect(r.node.fill).toMatchObject({ type: "radial", center: [0.5, 0.5] });
    expect(r.warnings).toEqual([]);
  });
});

describe("url() image fills", () => {
  test.each([
    [undefined, "cover"],
    ["auto", "cover"],
    ["cover", "cover"],
    ["contain", "contain"],
    ["100% 100%", "stretch"],
  ])("background-size %s -> %s", (size, fit) => {
    const r = convert(
      el("div", box(0, 0, 50, 50), {
        backgroundImage: `url("${PNG}")`,
        ...(size ? { backgroundSize: size } : {}),
      }),
    );
    expect(r.node.fill).toEqual({ type: "image", src: PNG, fit });
  });
});

describe("fonts", () => {
  const page = () =>
    snap(
      el("div", box(0, 0, 300, 100), {}, [
        text("A", box(0, 0, 20, 20), { fontFamily: '"Geist", "Inter", sans-serif' }),
        text("B", box(0, 30, 20, 20), { fontFamily: '"Geist", "Inter", sans-serif' }),
        text("C", box(0, 60, 20, 20), { fontFamily: "system-ui, sans-serif" }),
      ]),
    );
  test("resolveFont gets the split stack once per stack; undefined falls back", () => {
    const calls: string[][] = [];
    const r = convertDomSnapshot(page(), {
      resolveFont: (families) => {
        calls.push(families);
        return families[0] === "Geist" ? "Geist Sans" : undefined;
      },
    });
    expect((r.node.children as Json[]).map((k) => k.fontFamily)).toEqual([
      "Geist Sans",
      "Geist Sans",
      "Inter",
    ]);
    expect(calls).toEqual([
      ["Geist", "Inter", "sans-serif"],
      ["system-ui", "sans-serif"],
    ]);
  });
  test("a throwing resolver falls back to pickFontFamily", () => {
    const r = convertDomSnapshot(page(), {
      resolveFont: () => {
        throw new Error("boom");
      },
    });
    expect((r.node.children as Json[])[0]?.fontFamily).toBe("Geist");
  });
});

describe("images", () => {
  test("raster stand-ins are plain fixed-size images in a stack", () => {
    const r = convert(
      el("div", box(0, 0, 200, 100), { display: "block" }, [
        {
          kind: "image",
          tag: "canvas",
          src: PNG,
          raster: true,
          box: box(0, 0, 200, 60),
          style: {},
        },
        text("Caption", box(0, 70, 60, 20), T, true),
      ]),
    );
    expect(r.node.layout).toBe("vertical");
    expect(r.kids[0]).toMatchObject({ type: "image", width: 200, height: 60 });
    expectFaithful(r);
  });
});

describe("synthetic page", () => {
  test("every container is auto layout and every box lands where the page had it", () => {
    const r = convert(syntheticPage());
    expect(r.stats).toEqual({ autoLayout: 12, absolute: 0 });
    expect(r.node).toMatchObject({ layout: "vertical", width: 1000 });
    expect(r.node.height).toBeUndefined();
    const hero = r.kids[1];
    expect(hero).toMatchObject({ layout: "vertical", gap: 16, padding: [64, 32, 64, 32] });
    expect(hero?.children[1]).toMatchObject({ type: "text", width: "fill_container" });
    const cards = r.kids[2];
    expect(cards?.children.map((c: Json) => c.width)).toEqual([
      "fill_container",
      "fill_container",
      "fill_container",
    ]);
    expectFaithful(r);
  });
});

describe("robustness", () => {
  test("random geometry never throws and stays schema-valid", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const displays = ["block", "flex", "inline-flex", "grid", undefined];
    const make = (depth: number, x: number, y: number, w: number, h: number): DomSnapshotNode => {
      if (depth > 3 || (depth > 0 && rand() < 0.3))
        return rand() < 0.5
          ? text(`t${Math.floor(rand() * 1e6)}`, box(x, y, w, h), { fontSize: 14, lineHeight: 20 })
          : leaf(`L${Math.floor(rand() * 1e6)}`, x, y, w, h);
      const n = 1 + Math.floor(rand() * 4);
      const kids = Array.from({ length: n }, (_, i) =>
        make(
          depth + 1,
          x + rand() * 10,
          y + (i * h) / n,
          w * (0.5 + rand() / 2),
          h / n - rand() * 4,
        ),
      );
      return el(
        "div",
        box(x, y, w, h),
        {
          display: displays[Math.floor(rand() * displays.length)],
          flexDirection: rand() < 0.5 ? "column" : "row",
          padding: [rand() * 8, rand() * 8, Number.NaN, rand() * 8],
          justifyContent: rand() < 0.5 ? "center" : "space-evenly",
          alignItems: rand() < 0.5 ? "stretch" : "baseline",
          gap: rand() < 0.5 ? Number.NaN : 4,
        },
        kids,
      );
    };
    for (let i = 0; i < 30; i++) {
      const r = convertDomSnapshot(snap(make(0, 0, 0, 400, 400)));
      assertValid(r.node);
      expect(r.stats.autoLayout + r.stats.absolute).toBeGreaterThan(0);
    }
  });
});
