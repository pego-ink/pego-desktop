export type Rgba = { r: number; g: number; b: number; a: number };

/** Parse #rgb, #rgba, #rrggbb or #rrggbbaa. Returns null for anything else. */
export const parseHex = (value: string): Rgba | null => {
  const match = /^#([0-9a-fA-F]+)$/.exec(value.trim());
  const digits = match?.[1];
  if (!digits || ![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits;
  const channel = (i: number) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1,
  };
};

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance (0 black .. 1 white). */
export const relativeLuminance = ({ r, g, b }: Rgba): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG 2 contrast ratio (1 .. 21) between two opaque colors. */
export const contrastRatio = (a: Rgba, b: Rgba): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Composite `top` (with its alpha) over an opaque `bottom`. */
export const compositeOver = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

/** WCAG AA minimum for text: 3:1 for large text (>= 24px, or >= 18.66px and bold), else 4.5:1. */
export const wcagAaThreshold = (fontSize: number, fontWeight: number): number =>
  fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;

export const contrastBetweenHex = (foreground: string, background: string): number | null => {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return null;
  const opaqueBg = compositeOver(bg, { r: 255, g: 255, b: 255, a: 1 });
  return contrastRatio(compositeOver(fg, opaqueBg), opaqueBg);
};
