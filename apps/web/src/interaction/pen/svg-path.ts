import { cornerAnchor, pt, samePt, type Anchor, type Contour, type Pt } from "./anchors";

const ARG_COUNT: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

type Token = { cmd: string } | { num: number };

const tokenize = (d: string): Token[] | null => {
  const tokens: Token[] = [];
  let consumed = 0;
  for (const m of d.matchAll(TOKEN)) {
    // Anything other than whitespace/commas between tokens means malformed data.
    if (d.slice(consumed, m.index).replace(/[\s,]/g, "") !== "") return null;
    consumed = m.index + m[0].length;
    if (m[1]) tokens.push({ cmd: m[1] });
    else tokens.push({ num: Number(m[2]) });
  }
  if (d.slice(consumed).replace(/[\s,]/g, "") !== "") return null;
  return tokens;
};

const handleOrNull = (handle: Pt, anchor: Pt): Pt | null =>
  samePt(handle, anchor) ? null : handle;

/**
 * Parse SVG path data (M L H V C S Q T Z, absolute and relative) into contours. Arcs are
 * approximated by a straight line to their end point. Returns null for malformed data.
 */
export const parseSvgPath = (d: string): Contour[] | null => {
  const tokens = tokenize(d);
  if (!tokens || tokens.length === 0) return null;
  const head = tokens[0];
  if (!head || !("cmd" in head) || head.cmd.toLowerCase() !== "m") return null;

  const contours: Contour[] = [];
  let anchors: Anchor[] = [];
  let cur = pt(0, 0);
  let start = pt(0, 0);
  /** Last control point, for S/T reflection, and which family it belongs to. */
  let lastCtrl = null as { p: Pt; kind: "c" | "q" } | null;

  const flush = (closed: boolean) => {
    if (closed ? anchors.length >= 1 : anchors.length >= 2) contours.push({ anchors, closed });
    anchors = [];
  };
  const ensureStarted = () => {
    if (anchors.length === 0) anchors = [cornerAnchor(cur)];
  };
  const last = () => anchors[anchors.length - 1] as Anchor;
  const lineTo = (to: Pt) => {
    ensureStarted();
    anchors.push(cornerAnchor(to));
    cur = to;
    lastCtrl = null;
  };
  const cubicTo = (c1: Pt, c2: Pt, to: Pt) => {
    ensureStarted();
    const prev = last();
    anchors[anchors.length - 1] = { ...prev, out: handleOrNull(c1, prev.p) };
    anchors.push({ p: to, in: handleOrNull(c2, to), out: null });
    cur = to;
    lastCtrl = { p: c2, kind: "c" };
  };
  const quadTo = (c: Pt, to: Pt) => {
    const from = cur;
    cubicTo(
      pt(from.x + ((c.x - from.x) * 2) / 3, from.y + ((c.y - from.y) * 2) / 3),
      pt(to.x + ((c.x - to.x) * 2) / 3, to.y + ((c.y - to.y) * 2) / 3),
      to,
    );
    lastCtrl = { p: c, kind: "q" };
  };

  let i = 0;
  let cmd: string | null = null;
  while (i < tokens.length) {
    const token = tokens[i] as Token;
    if ("cmd" in token) {
      cmd = token.cmd;
      i++;
      if (cmd === "Z" || cmd === "z") {
        const first = anchors[0];
        const end = anchors[anchors.length - 1];
        if (first && end && anchors.length >= 2 && samePt(first.p, end.p)) {
          anchors[0] = { ...first, in: end.in };
          anchors.pop();
        }
        flush(true);
        cur = start;
        lastCtrl = null;
        continue;
      }
    } else if (cmd === null || cmd === "Z" || cmd === "z") {
      return null;
    }
    if (!cmd) return null;
    const count = ARG_COUNT[cmd.toLowerCase()] as number;
    const args: number[] = [];
    for (let k = 0; k < count; k++) {
      const t = tokens[i + k];
      if (!t || !("num" in t)) return null;
      args.push(t.num);
    }
    i += count;
    const rel: boolean = cmd === cmd.toLowerCase();
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    const a = (n: number) => args[n] as number;

    switch (cmd.toLowerCase()) {
      case "m": {
        flush(false);
        cur = pt(a(0) + ox, a(1) + oy);
        start = cur;
        anchors = [cornerAnchor(cur)];
        lastCtrl = null;
        // Further coordinate pairs are implicit line-tos.
        cmd = rel ? "l" : "L";
        break;
      }
      case "l":
        lineTo(pt(a(0) + ox, a(1) + oy));
        break;
      case "h":
        lineTo(pt(a(0) + ox, cur.y));
        break;
      case "v":
        lineTo(pt(cur.x, a(0) + oy));
        break;
      case "c":
        cubicTo(pt(a(0) + ox, a(1) + oy), pt(a(2) + ox, a(3) + oy), pt(a(4) + ox, a(5) + oy));
        break;
      case "s": {
        const c1 =
          lastCtrl?.kind === "c" ? pt(2 * cur.x - lastCtrl.p.x, 2 * cur.y - lastCtrl.p.y) : cur;
        cubicTo(c1, pt(a(0) + ox, a(1) + oy), pt(a(2) + ox, a(3) + oy));
        break;
      }
      case "q":
        quadTo(pt(a(0) + ox, a(1) + oy), pt(a(2) + ox, a(3) + oy));
        break;
      case "t": {
        const c =
          lastCtrl?.kind === "q" ? pt(2 * cur.x - lastCtrl.p.x, 2 * cur.y - lastCtrl.p.y) : cur;
        quadTo(c, pt(a(0) + ox, a(1) + oy));
        break;
      }
      case "a":
        lineTo(pt(a(5) + ox, a(6) + oy));
        break;
    }
  }
  flush(false);
  return contours.length > 0 ? contours : null;
};

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

const segmentTo = (from: Anchor, to: Anchor): string => {
  if (!from.out && !to.in) return `L${num(to.p.x)} ${num(to.p.y)}`;
  const c1 = from.out ?? from.p;
  const c2 = to.in ?? to.p;
  return `C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(to.p.x)} ${num(to.p.y)}`;
};

/** Write contours as absolute M/L/C/Z path data. */
export const serializeContours = (contours: readonly Contour[]): string =>
  contours
    .map((c) => {
      const [first] = c.anchors;
      if (!first) return "";
      const parts = [`M${num(first.p.x)} ${num(first.p.y)}`];
      for (let i = 1; i < c.anchors.length; i++) {
        parts.push(segmentTo(c.anchors[i - 1] as Anchor, c.anchors[i] as Anchor));
      }
      if (c.closed) {
        const end = c.anchors[c.anchors.length - 1] as Anchor;
        if ((end.out || first.in) && c.anchors.length > 1) parts.push(segmentTo(end, first));
        parts.push("Z");
      }
      return parts.join("");
    })
    .join("");
