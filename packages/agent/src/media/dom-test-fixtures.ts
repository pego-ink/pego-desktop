/** Shared builders and a synthetic page for the DOM import tests. */
import { computeLayout, nodeSchema, type Box, type PegoDocument } from "@pego/doc";
import type { DomBox, DomSnapshot, DomSnapshotNode, DomStyle } from "../browser-types";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const box = (x: number, y: number, width: number, height: number): DomBox => ({
  x,
  y,
  width,
  height,
});
export const el = (
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
export const text = (
  t: string,
  b: DomBox,
  style: DomStyle = {},
  merged?: boolean,
): DomSnapshotNode => ({
  kind: "text",
  text: t,
  box: b,
  style,
  ...(merged ? { merged } : {}),
});
export const snap = (root: DomSnapshotNode, title = "Home"): DomSnapshot => ({
  url: "https://example.com/",
  title,
  root,
});

/** Give every node an id and run the document schema over the whole tree. */
export const assertValid = (node: Json, n = { i: 0 }): void => {
  const withIds = (raw: Json): Json => ({
    ...raw,
    id: `n${n.i++}`,
    ...(raw.children ? { children: raw.children.map(withIds) } : {}),
  });
  const result = nodeSchema.safeParse(withIds(node));
  if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 3)));
};

/**
 * Lay the converted tree out with Pego's engine (text measured as its DOM box, looked up by
 * content) and return every node's box by name, in the snapshot's page coordinates.
 */
export const layoutByName = (snapshot: DomSnapshot, converted: Json): Map<string, Box> => {
  const texts = new Map<string, { box: DomBox; lines: number }>();
  const walk = (node: DomSnapshotNode) => {
    if (node.kind === "text") {
      const size = node.style.fontSize ?? 16;
      const lineHeight = node.style.lineHeight ?? size * 1.25;
      const wraps = !/^(nowrap|pre)$/.test(node.style.whiteSpace ?? "");
      const lines = wraps ? Math.max(1, Math.round(node.box.height / lineHeight)) : 1;
      texts.set(node.text.trim(), { box: node.box, lines });
    }
    if (node.kind === "element") node.children.forEach(walk);
  };
  walk(snapshot.root);
  let i = 0;
  const names = new Map<string, string>();
  const withIds = (raw: Json): Json => {
    const id = `n${i++}`;
    if (typeof raw.name === "string") names.set(id, raw.name);
    return { ...raw, id, ...(raw.children ? { children: raw.children.map(withIds) } : {}) };
  };
  const root = nodeSchema.parse(withIds(converted));
  const doc = {
    version: 6,
    id: "d",
    name: "d",
    variables: {},
    children: [{ type: "page", id: "p", name: "p", x: 0, y: 0, children: [root] }],
  } as unknown as PegoDocument;
  const layout = computeLayout(doc, (node, maxWidth) => {
    // Like the editor: unconstrained text runs on one line.
    const t = texts.get(String(node.content));
    const width = t?.box.width ?? 0;
    const height = t?.box.height ?? 0;
    const lines = t?.lines ?? 1;
    if (maxWidth === undefined) return { width: width * lines, height: height / lines };
    if (maxWidth >= width - 1) return { width, height };
    return { width: maxWidth, height: height * Math.ceil(width / Math.max(1, maxWidth)) };
  });
  const origin = snapshot.root.box;
  const out = new Map<string, Box>();
  for (const [id, b] of layout) {
    const name = names.get(id);
    if (name !== undefined && !out.has(name))
      out.set(name, { ...b, x: b.x + origin.x, y: b.y + origin.y });
  }
  return out;
};

const T = (size: number, lh: number, extra: DomStyle = {}): DomStyle => ({
  fontSize: size,
  lineHeight: lh,
  color: "rgb(17, 24, 39)",
  ...extra,
});

const button = (label: string, x: number, y: number, w: number, tw: number, name: string) =>
  el(
    "a",
    box(x, y, w, 44),
    { display: "inline-block", backgroundColor: "rgb(79, 70, 229)", padding: [12, 24, 12, 24] },
    [text(label, box(x + 24, y + 12, tw, 20), T(14, 20, { color: "#fff" }), true)],
    name,
  );

const card = (i: number, x: number) =>
  el(
    "div",
    box(x, 404, 296, 126),
    {
      display: "block",
      flexGrow: 1,
      padding: [24, 24, 24, 24],
      borderWidth: [1, 1, 1, 1],
      borderColor: "rgb(229, 231, 235)",
      borderRadius: 12,
    },
    [
      text(`Card ${i}`, box(x + 25, 429, 60, 20), T(16, 20, { fontWeight: 600 }), true),
      text(
        `Description ${i} that wraps onto two lines`,
        box(x + 25, 457, 240, 48),
        T(14, 24),
        true,
      ),
    ],
    `Card${i}`,
  );

/** A small landing page (1000 px wide) whose layout CSS can express exactly. */
export const syntheticPage = (): DomSnapshot =>
  snap(
    el("body", box(0, 0, 1000, 622), { display: "block" }, [
      el(
        "header",
        box(0, 0, 1000, 64),
        {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: [16, 32, 16, 32],
          borderWidth: [0, 0, 1, 0],
          borderColor: "rgb(229, 231, 235)",
          backgroundColor: "rgb(255, 255, 255)",
        },
        [
          text("Acme", box(32, 20, 60, 24), T(20, 24, { fontWeight: 700 }), true),
          el(
            "nav",
            box(776, 20, 192, 24),
            { display: "flex", columnGap: 24, rowGap: 24, gap: 24 },
            [
              text("Home", box(776, 20, 40, 24), T(14, 24)),
              text("Pricing", box(840, 20, 56, 24), T(14, 24)),
              text("About", box(920, 20, 48, 24), T(14, 24)),
            ],
            "Nav",
          ),
        ],
        "Header",
      ),
      el(
        "section",
        box(0, 64, 1000, 308),
        { display: "block", padding: [64, 32, 64, 32], backgroundColor: "rgb(238, 242, 255)" },
        [
          text("Build faster", box(32, 128, 400, 48), T(40, 48, { fontWeight: 800 }), true),
          text(
            "A long paragraph that wraps across the whole width of the hero section",
            box(32, 192, 930, 56),
            T(16, 28, { margin: [0, 0, 16, 0] }),
            true,
          ),
          el(
            "div",
            box(32, 264, 248, 44),
            { display: "flex", columnGap: 12, gap: 12 },
            [
              button("Get started", 32, 264, 120, 72, "Primary"),
              button("Learn more", 164, 264, 116, 68, "Secondary"),
            ],
            "Actions",
          ),
        ],
        "Hero",
      ),
      el(
        "section",
        box(0, 372, 1000, 190),
        { display: "flex", columnGap: 24, gap: 24, padding: [32, 32, 32, 32] },
        [card(1, 32), card(2, 352), card(3, 672)],
        "Cards",
      ),
      el(
        "footer",
        box(0, 562, 1000, 60),
        { display: "block", padding: [20, 20, 20, 20] },
        [
          text(
            "Copyright 2026 Acme",
            box(430, 582, 140, 20),
            T(12, 20, { textAlign: "center" }),
            true,
          ),
        ],
        "Footer",
      ),
    ]),
    "Acme site",
  );

/** The converter's name for a text node (first 30 characters). */
export const textName = (t: string): string => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > 30 ? `${flat.slice(0, 30).trimEnd()}...` : flat;
};

/** Every element/text box of a snapshot by the name the converter gives it. */
export const domBoxesByName = (snapshot: DomSnapshot): Map<string, DomBox> => {
  const out = new Map<string, DomBox>();
  const walk = (node: DomSnapshotNode) => {
    if (node.kind === "text") out.set(textName(node.text), node.box);
    if (node.kind === "element") {
      if (node.component) out.set(`${node.component} - ${node.tag}`, node.box);
      node.children.forEach(walk);
    }
  };
  walk(snapshot.root);
  return out;
};
