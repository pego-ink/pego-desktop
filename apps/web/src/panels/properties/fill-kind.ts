import { shaderFallbackColor, type Fill, type GradientStop } from "@pego/doc";

export type FillKind = "solid" | "linear" | "radial" | "image" | "shader";

export const FILL_KINDS: readonly [FillKind, string][] = [
  ["solid", "Solid"],
  ["linear", "Linear gradient"],
  ["radial", "Radial gradient"],
  ["image", "Image"],
  ["shader", "Shader (animated)"],
];

export const kindOfFill = (fill: Fill): FillKind =>
  typeof fill === "string" ? "solid" : fill.type;

const stopsOf = (fill: Fill): GradientStop[] => {
  if (typeof fill === "string") {
    return [
      { color: fill, position: 0 },
      { color: "#FFFFFF", position: 1 },
    ];
  }
  if (fill.type === "image") {
    return [
      { color: "#D9D9D9", position: 0 },
      { color: "#FFFFFF", position: 1 },
    ];
  }
  if (fill.type === "shader") {
    return [
      { color: shaderFallbackColor(fill, {}), position: 0 },
      { color: "#FFFFFF", position: 1 },
    ];
  }
  return fill.stops;
};

/**
 * Switch a fill to another kind, keeping what carries over: the solid color becomes the first
 * gradient stop and back, and gradients keep their stops. A shader starts as the aurora preset.
 * Image needs a picked file, so it returns null and the caller asks for one.
 */
export const convertFill = (fill: Fill, kind: FillKind): Fill | null => {
  switch (kind) {
    case "solid":
      return typeof fill === "string" ? fill : (stopsOf(fill)[0]?.color ?? "#D9D9D9");
    case "linear":
      return { type: "linear", angle: 180, stops: stopsOf(fill) };
    case "radial":
      return { type: "radial", center: [0.5, 0.5], radius: [0.5, 0.5], stops: stopsOf(fill) };
    case "image":
      return null;
    case "shader":
      return typeof fill === "object" && fill.type === "shader"
        ? fill
        : { type: "shader", preset: "aurora" };
  }
};

/** Insert a stop halfway between the last two, in the color of the last. */
export const addStop = (stops: readonly GradientStop[]): GradientStop[] => {
  const last = stops.at(-1);
  const before = stops.at(-2);
  if (!last) return [{ color: "#FFFFFF", position: 1 }];
  const position = before ? (before.position + last.position) / 2 : last.position;
  return [...stops.slice(0, -1), { color: last.color, position }, last];
};
