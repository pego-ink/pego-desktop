/** Color and style parsing for SVG presentation attributes (pure, no DOM). */

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  navy: "#000080",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  lime: "#00ff00",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  olive: "#808000",
  brown: "#a52a2a",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
  crimson: "#dc143c",
  coral: "#ff7f50",
  salmon: "#fa8072",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  tan: "#d2b48c",
  beige: "#f5f5dc",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  skyblue: "#87ceeb",
  steelblue: "#4682b4",
  royalblue: "#4169e1",
  slategray: "#708090",
  slategrey: "#708090",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  darkblue: "#00008b",
  darkgreen: "#006400",
  darkred: "#8b0000",
  whitesmoke: "#f5f5f5",
  gainsboro: "#dcdcdc",
  transparent: "#00000000",
};

const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

const channel = (token: string): number =>
  token.endsWith("%") ? (Number.parseFloat(token) / 100) * 255 : Number.parseFloat(token);

const alphaOf = (token: string | undefined): number => {
  if (token === undefined) return 1;
  const value = token.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = (t + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255];
};

/** Add an opacity multiplier to a hex color, returning #rrggbb or #rrggbbaa. */
export const withAlpha = (hex: string, alpha: number): string => {
  if (alpha >= 1) return hex;
  const base = hex.slice(1, 7);
  const existing = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return `#${base}${hex2(existing * alpha * 255)}`;
};

/** Parse a CSS color into #rrggbb / #rrggbbaa, or null when unsupported. */
export const parseColor = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  }
  if (/^#[0-9a-f]{4}$/.test(value)) {
    return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  }
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return value;
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
  if (fn) {
    const parts = (fn[2] ?? "").split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = alphaOf(parts[3]);
    let rgb: [number, number, number];
    if (fn[1]?.startsWith("rgb")) {
      rgb = [channel(parts[0] ?? "0"), channel(parts[1] ?? "0"), channel(parts[2] ?? "0")];
    } else {
      rgb = hslToRgb(
        Number.parseFloat(parts[0] ?? "0"),
        Number.parseFloat(parts[1] ?? "0") / 100,
        Number.parseFloat(parts[2] ?? "0") / 100,
      );
    }
    if (rgb.some((n) => !Number.isFinite(n))) return null;
    return withAlpha(`#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`, alpha);
  }
  return NAMED_COLORS[value] ?? null;
};

/**
 * Parse an inline `style` attribute into lowercase property/value pairs. Throws when it carries
 * something unsafe: `@import`, `expression(`, `javascript:` or a `url()` that is not `#id`.
 */
export const parseStyleAttribute = (style: string): Record<string, string> => {
  assertSafeCss(style);
  const out: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!important/i, "")
      .trim();
    if (key && value) out[key] = value;
  }
  return out;
};

export const assertSafeCss = (css: string): void => {
  if (/@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)) {
    throw new Error("style contains unsafe CSS");
  }
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!(match[2] ?? "").trim().startsWith("#")) {
      throw new Error("style references an external url()");
    }
  }
};

/** `url(#id)` to `id`, or null. */
export const urlReference = (value: string): string | null =>
  /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(value.trim())?.[1] ?? null;

/** Parse a number with an optional unit (px, pt, %...). Percentages need `base`. */
export const parseLength = (value: string | undefined, base?: number): number | null => {
  if (value === undefined) return null;
  const match =
    /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|rem|%)?\s*$/.exec(
      value,
    );
  if (!match) return null;
  const n = Number(match[1]);
  switch (match[2]) {
    case "%":
      return base === undefined ? null : (n / 100) * base;
    case "pt":
      return (n * 4) / 3;
    case "pc":
      return n * 16;
    case "mm":
      return (n * 96) / 25.4;
    case "cm":
      return (n * 96) / 2.54;
    case "in":
      return n * 96;
    case "em":
    case "rem":
      return n * 16;
    default:
      return n;
  }
};
