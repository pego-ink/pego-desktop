import type { Fill, Variables } from "./schema";

const isVariableRef = (value: string) => value.startsWith("$");

/** Resolve a number that may be a `$variable` reference. */
export const resolveNumber = (
  value: number | string | undefined,
  variables: Variables,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  const variable = isVariableRef(value) ? variables[value.slice(1)] : undefined;
  return variable?.type === "number" ? variable.value : fallback;
};

/** Resolve a color that may be a `$variable` reference. Returns a CSS hex string or undefined. */
export const resolveColor = (
  value: string | undefined,
  variables: Variables,
): string | undefined => {
  if (value === undefined) return undefined;
  if (!isVariableRef(value)) return value;
  const variable = variables[value.slice(1)];
  return variable?.type === "color" ? variable.value : undefined;
};

/** Resolve a string that may be a `$variable` reference. */
export const resolveString = (value: string, variables: Variables): string => {
  if (!isVariableRef(value)) return value;
  const variable = variables[value.slice(1)];
  return variable?.type === "string" ? variable.value : value;
};

export type Sides = [top: number, right: number, bottom: number, left: number];

/** Resolve a one-value-or-four-sides prop (padding, stroke width) to [top, right, bottom, left]. */
export const resolveSides = (
  value: number | string | readonly (number | string)[] | undefined,
  variables: Variables,
  fallback: number,
): Sides => {
  if (!Array.isArray(value)) {
    const all = resolveNumber(value as number | string | undefined, variables, fallback);
    return [all, all, all, all];
  }
  const [top, right, bottom, left] = value.map((v) => resolveNumber(v, variables, fallback));
  return [top ?? fallback, right ?? fallback, bottom ?? fallback, left ?? fallback];
};

/**
 * One width for a stroke that may be per side: the widest side (0 when every side is hidden).
 * For outlines that cannot draw sides separately (paths, hit slack, image borders).
 */
export const resolveStrokeWidth = (
  width: number | string | readonly (number | string)[] | undefined,
  variables: Variables,
  fallback = 1,
): number => Math.max(0, ...resolveSides(width, variables, fallback));

/**
 * One solid color standing in for a fill (contrast checks, default text color): the color itself,
 * a gradient's first stop, or undefined for images and unset fills.
 */
export const representativeColor = (
  fill: Fill | undefined,
  variables: Variables,
): string | undefined => {
  if (fill === undefined) return undefined;
  if (typeof fill === "string") return resolveColor(fill, variables);
  if (fill.type === "image") return undefined;
  return resolveColor(fill.stops[0]?.color, variables);
};
