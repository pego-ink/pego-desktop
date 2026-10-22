/** Affine matrices, SVG path parsing and shape-to-path conversion (pure, no DOM). */

/** [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
export type Point = { x: number; y: number };

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `outer` applied after `inner`. */
export const multiply = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];

export const apply = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

/** Only translate and positive/negative axis scale: rects and ellipses stay rects and ellipses. */
export const isAxisAligned = (m: Matrix): boolean => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

/** Mean scale factor, used for stroke widths. */
export const meanScale = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

const numbers = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number);

/** Parse an SVG `transform` list. `unsupported` lists functions that could not be applied. */
export const parseTransform = (value: string): { matrix: Matrix; unsupported: string[] } => {
  let matrix: Matrix = IDENTITY;
  const unsupported: string[] = [];
  const pattern = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1] ?? "";
    const args = numbers(match[2] ?? "");
    const [a = 0, b, c, d, e, f] = args;
    let next: Matrix | null = null;
    if (name === "translate") next = [1, 0, 0, 1, a, b ?? 0];
    else if (name === "scale") next = [a, 0, 0, b ?? a, 0, 0];
    else if (name === "rotate") {
      const rad = (a * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
      const cx = b ?? 0;
      const cy = c ?? 0;
      next = multiply([1, 0, 0, 1, cx, cy], multiply(rotation, [1, 0, 0, 1, -cx, -cy]));
    } else if (name === "skewX") next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    else if (name === "matrix" && args.length === 6) {
      next = [a, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0];
    }
    if (next && next.every(Number.isFinite)) matrix = multiply(matrix, next);
    else unsupported.push(name);
  }
  return { matrix, unsupported };
};

// --- path data ------------------------------------------------------------------

/** Absolute, normalized segments: arcs become cubics, H/V become lines, S/T are expanded. */
export type Segment =
  | { type: "M" | "L"; p: Point }
  | { type: "Q"; c: Point; p: Point }
  | { type: "C"; c1: Point; c2: Point; p: Point }
  | { type: "Z" };

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

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

const arcToCubics = (
  from: Point,
  rxIn: number,
  ryIn: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  to: Point,
): Segment[] => {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    return [{ type: "L", p: to }];
  }
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / denominator));
  const sign = large === sweep ? -1 : 1;
  const cxp = (sign * root * rx * y1) / ry;
  const cyp = (-sign * root * ry * x1) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (theta: number): Point => ({
    x: cx + rx * Math.cos(theta) * cosPhi - ry * Math.sin(theta) * sinPhi,
    y: cy + rx * Math.cos(theta) * sinPhi + ry * Math.sin(theta) * cosPhi,
  });
  const derivative = (theta: number): Point => ({
    x: -rx * Math.sin(theta) * cosPhi - ry * Math.cos(theta) * sinPhi,
    y: -rx * Math.sin(theta) * sinPhi + ry * Math.cos(theta) * cosPhi,
  });
  const out: Segment[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const t1 = theta1 + i * step;
    const t2 = t1 + step;
    const p1 = at(t1);
    const p2 = i === pieces - 1 ? to : at(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    out.push({
      type: "C",
      c1: { x: p1.x + k * d1.x, y: p1.y + k * d1.y },
      c2: { x: p2.x - k * d2.x, y: p2.y - k * d2.y },
      p: p2,
    });
  }
  return out;
};

/** Parse path data into absolute segments. Throws PathError on a malformed path. */
export const parsePathData = (data: string): Segment[] => {
  const segments: Segment[] = [];
  let pos = 0;
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCubic: Point | null = null;
  let lastQuad: Point | null = null;

  const skip = () => {
    while (pos < data.length && /[\s,]/.test(data[pos] ?? "")) pos += 1;
  };
  const readNumber = (): number => {
    skip();
    const rest = data.slice(pos);
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest);
    if (!match) throw new PathError(`expected a number at offset ${pos}`);
    pos += match[0].length;
    return Number(match[0]);
  };
  const readFlag = (): boolean => {
    skip();
    const char = data[pos];
    if (char !== "0" && char !== "1") throw new PathError(`expected an arc flag at offset ${pos}`);
    pos += 1;
    return char === "1";
  };

  let command = "";
  let first = true;
  for (;;) {
    skip();
    if (pos >= data.length) break;
    const char = data[pos] ?? "";
    if (/[A-Za-z]/.test(char)) {
      if (!(char.toLowerCase() in ARG_COUNT)) throw new PathError(`unknown command "${char}"`);
      command = char;
      pos += 1;
    } else if (command === "" || command.toLowerCase() === "z") {
      throw new PathError(`unexpected data at offset ${pos}`);
    } else if (command === "M") command = "L";
    else if (command === "m") command = "l";
    if (first && command.toLowerCase() !== "m") throw new PathError("path must start with M");
    first = false;

    const relative = command === command.toLowerCase();
    const lower = command.toLowerCase();
    const base = relative ? cur : { x: 0, y: 0 };
    const abs = (x: number, y: number): Point => ({ x: base.x + x, y: base.y + y });

    if (lower === "z") {
      segments.push({ type: "Z" });
      cur = start;
      lastCubic = null;
      lastQuad = null;
      continue;
    }
    if (lower === "m") {
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "M", p });
      cur = p;
      start = p;
      lastCubic = null;
      lastQuad = null;
    } else if (lower === "l") {
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "L", p });
      cur = p;
      lastCubic = null;
      lastQuad = null;
    } else if (lower === "h") {
      const x = readNumber();
      const p = { x: relative ? cur.x + x : x, y: cur.y };
      segments.push({ type: "L", p });
      cur = p;
      lastCubic = null;
      lastQuad = null;
    } else if (lower === "v") {
      const y = readNumber();
      const p = { x: cur.x, y: relative ? cur.y + y : y };
      segments.push({ type: "L", p });
      cur = p;
      lastCubic = null;
      lastQuad = null;
    } else if (lower === "c") {
      const c1 = abs(readNumber(), readNumber());
      const c2 = abs(readNumber(), readNumber());
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "C", c1, c2, p });
      cur = p;
      lastCubic = c2;
      lastQuad = null;
    } else if (lower === "s") {
      const c1: Point = lastCubic
        ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y }
        : cur;
      const c2 = abs(readNumber(), readNumber());
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "C", c1, c2, p });
      cur = p;
      lastCubic = c2;
      lastQuad = null;
    } else if (lower === "q") {
      const c = abs(readNumber(), readNumber());
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "Q", c, p });
      cur = p;
      lastQuad = c;
      lastCubic = null;
    } else if (lower === "t") {
      const c: Point = lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
      const p = abs(readNumber(), readNumber());
      segments.push({ type: "Q", c, p });
      cur = p;
      lastQuad = c;
      lastCubic = null;
    } else {
      const rx = readNumber();
      const ry = readNumber();
      const rotation = readNumber();
      const large = readFlag();
      const sweep = readFlag();
      const p = abs(readNumber(), readNumber());
      segments.push(...arcToCubics(cur, rx, ry, rotation, large, sweep, p));
      cur = p;
      lastCubic = null;
      lastQuad = null;
    }
  }
  if (segments.length === 0) throw new PathError("empty path");
  return segments;
};

export const transformSegments = (segments: Segment[], m: Matrix): Segment[] =>
  segments.map((segment): Segment => {
    switch (segment.type) {
      case "M":
      case "L":
        return { type: segment.type, p: apply(m, segment.p) };
      case "Q":
        return { type: "Q", c: apply(m, segment.c), p: apply(m, segment.p) };
      case "C":
        return {
          type: "C",
          c1: apply(m, segment.c1),
          c2: apply(m, segment.c2),
          p: apply(m, segment.p),
        };
      case "Z":
        return segment;
    }
  });

export type Bounds = { x: number; y: number; width: number; height: number };

/** Bounding box by sampling curves (control points alone overestimate). Null if no points. */
export const segmentBounds = (segments: Segment[]): Bounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Point) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  let cur: Point = { x: 0, y: 0 };
  let start: Point = cur;
  for (const segment of segments) {
    if (segment.type === "Z") {
      cur = start;
      continue;
    }
    if (segment.type === "M") start = segment.p;
    if (segment.type === "Q") {
      for (let i = 1; i <= 16; i += 1) {
        const t = i / 16;
        const u = 1 - t;
        add({
          x: u * u * cur.x + 2 * u * t * segment.c.x + t * t * segment.p.x,
          y: u * u * cur.y + 2 * u * t * segment.c.y + t * t * segment.p.y,
        });
      }
    } else if (segment.type === "C") {
      for (let i = 1; i <= 24; i += 1) {
        const t = i / 24;
        const u = 1 - t;
        add({
          x:
            u * u * u * cur.x +
            3 * u * u * t * segment.c1.x +
            3 * u * t * t * segment.c2.x +
            t * t * t * segment.p.x,
          y:
            u * u * u * cur.y +
            3 * u * u * t * segment.c1.y +
            3 * u * t * t * segment.c2.y +
            t * t * t * segment.p.y,
        });
      }
    } else add(segment.p);
    if (segment.type === "M") add(segment.p);
    cur = segment.p;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const round = (n: number): string => String(Math.round(n * 1000) / 1000 || 0);

/** Serialize segments, shifted by (-dx, -dy). */
export const serializeSegments = (segments: Segment[], dx = 0, dy = 0): string => {
  const pt = (p: Point) => `${round(p.x - dx)} ${round(p.y - dy)}`;
  return segments
    .map((segment) => {
      switch (segment.type) {
        case "M":
        case "L":
          return `${segment.type}${pt(segment.p)}`;
        case "Q":
          return `Q${pt(segment.c)} ${pt(segment.p)}`;
        case "C":
          return `C${pt(segment.c1)} ${pt(segment.c2)} ${pt(segment.p)}`;
        case "Z":
          return "Z";
      }
    })
    .join(" ");
};

// --- shapes as paths --------------------------------------------------------------

const KAPPA = 0.5522847498307936;

export const ellipseSegments = (cx: number, cy: number, rx: number, ry: number): Segment[] => {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    { type: "M", p: { x: cx + rx, y: cy } },
    {
      type: "C",
      c1: { x: cx + rx, y: cy + oy },
      c2: { x: cx + ox, y: cy + ry },
      p: { x: cx, y: cy + ry },
    },
    {
      type: "C",
      c1: { x: cx - ox, y: cy + ry },
      c2: { x: cx - rx, y: cy + oy },
      p: { x: cx - rx, y: cy },
    },
    {
      type: "C",
      c1: { x: cx - rx, y: cy - oy },
      c2: { x: cx - ox, y: cy - ry },
      p: { x: cx, y: cy - ry },
    },
    {
      type: "C",
      c1: { x: cx + ox, y: cy - ry },
      c2: { x: cx + rx, y: cy - oy },
      p: { x: cx + rx, y: cy },
    },
    { type: "Z" },
  ];
};

export const rectSegments = (
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): Segment[] => {
  const rX = Math.min(rx, w / 2);
  const rY = Math.min(ry, h / 2);
  if (rX <= 0 || rY <= 0) {
    return [
      { type: "M", p: { x, y } },
      { type: "L", p: { x: x + w, y } },
      { type: "L", p: { x: x + w, y: y + h } },
      { type: "L", p: { x, y: y + h } },
      { type: "Z" },
    ];
  }
  const ox = rX * KAPPA;
  const oy = rY * KAPPA;
  const corner = (c1: Point, c2: Point, p: Point): Segment => ({ type: "C", c1, c2, p });
  return [
    { type: "M", p: { x: x + rX, y } },
    { type: "L", p: { x: x + w - rX, y } },
    corner({ x: x + w - rX + ox, y }, { x: x + w, y: y + rY - oy }, { x: x + w, y: y + rY }),
    { type: "L", p: { x: x + w, y: y + h - rY } },
    corner(
      { x: x + w, y: y + h - rY + oy },
      { x: x + w - rX + ox, y: y + h },
      { x: x + w - rX, y: y + h },
    ),
    { type: "L", p: { x: x + rX, y: y + h } },
    corner({ x: x + rX - ox, y: y + h }, { x, y: y + h - rY + oy }, { x, y: y + h - rY }),
    { type: "L", p: { x, y: y + rY } },
    corner({ x, y: y + rY - oy }, { x: x + rX - ox, y }, { x: x + rX, y }),
    { type: "Z" },
  ];
};

/** polyline/polygon `points` attribute to segments. */
export const pointsSegments = (points: string, close: boolean): Segment[] => {
  const values = numbers(points);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    out.push({ type: i === 0 ? "M" : "L", p: { x: values[i] ?? 0, y: values[i + 1] ?? 0 } });
  }
  if (close && out.length > 0) out.push({ type: "Z" });
  return out;
};

export { numbers as parseNumbers };
