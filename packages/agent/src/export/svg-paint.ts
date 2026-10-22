import {
  linearGradientPoints,
  type ImageFill,
  type LinearGradient,
  type RadialGradient,
} from "@pego/doc";

/** A tiny SVG element description, serialized by either the IR builder or the SVG exporter. */
export type SvgDef = {
  tag: string;
  attrs: [name: string, value: string][];
  children: SvgDef[];
};

export type PaintArea = { x: number; y: number; width: number; height: number };
export type PaintSource = LinearGradient | RadialGradient | ImageFill;

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/** `#rgba` / `#rrggbbaa` split into an opaque color plus an opacity, since SVG 1.1 tools ignore alpha hex. */
export const splitAlpha = (value: string): { color: string; opacity?: number } => {
  const h = value.toLowerCase();
  if (/^#[0-9a-f]{4}$/.test(h)) {
    const [, r, g, b, a] = h.split("") as [string, string, string, string, string];
    return {
      color: `#${r}${r}${g}${g}${b}${b}`,
      opacity: Math.round((parseInt(a + a, 16) / 255) * 100) / 100,
    };
  }
  if (/^#[0-9a-f]{8}$/.test(h)) {
    return {
      color: h.slice(0, 7),
      opacity: Math.round((parseInt(h.slice(7), 16) / 255) * 100) / 100,
    };
  }
  return { color: h };
};

const ASPECT: Record<ImageFill["fit"], string> = {
  cover: "xMidYMid slice",
  contain: "xMidYMid meet",
  stretch: "none",
};

/**
 * The <linearGradient>, <radialGradient> or <pattern> that paints `area` (in the user space of
 * the element that references it). `resolveColor` maps a stop color to a CSS color or undefined.
 * Images use preserveAspectRatio, so no natural image size is needed.
 */
export const paintDef = (
  paint: PaintSource,
  id: string,
  area: PaintArea,
  angle: number,
  resolveColor: (value: string) => string | undefined,
): SvgDef => {
  const { x, y, width, height } = area;
  if (paint.type === "image") {
    return {
      tag: "pattern",
      attrs: [
        ["id", id],
        ["patternUnits", "userSpaceOnUse"],
        ["x", round(x)],
        ["y", round(y)],
        ["width", round(width)],
        ["height", round(height)],
      ],
      children: [
        {
          tag: "image",
          attrs: [
            ["href", paint.src],
            ["x", round(x)],
            ["y", round(y)],
            ["width", round(width)],
            ["height", round(height)],
            ["preserveAspectRatio", ASPECT[paint.fit]],
          ],
          children: [],
        },
      ],
    };
  }
  const stops = paint.stops.map((stop): SvgDef => {
    const { color, opacity } = splitAlpha(resolveColor(stop.color) ?? "#000000");
    return {
      tag: "stop",
      attrs: [
        ["offset", round(stop.position)],
        ["stop-color", color],
        ...(opacity !== undefined
          ? ([["stop-opacity", round(opacity)]] as [string, string][])
          : []),
      ],
      children: [],
    };
  });
  if (paint.type === "linear") {
    const { start, end } = linearGradientPoints(angle, width, height);
    return {
      tag: "linearGradient",
      attrs: [
        ["id", id],
        ["gradientUnits", "userSpaceOnUse"],
        ["x1", round(x + start.x)],
        ["y1", round(y + start.y)],
        ["x2", round(x + end.x)],
        ["y2", round(y + end.y)],
      ],
      children: stops,
    };
  }
  const [cx, cy] = paint.center;
  const [rx, ry] = paint.radius;
  const matrix = [rx * width, 0, 0, ry * height, x + cx * width, y + cy * height].map(round);
  return {
    tag: "radialGradient",
    attrs: [
      ["id", id],
      ["gradientUnits", "userSpaceOnUse"],
      ["cx", "0"],
      ["cy", "0"],
      ["r", "1"],
      ["gradientTransform", `matrix(${matrix.join(" ")})`],
    ],
    children: stops,
  };
};
