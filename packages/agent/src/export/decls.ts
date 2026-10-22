import type { Decl } from "./ir";

/** Canonical property order, so the same node always yields the same class/rule order. */
const ORDER = [
  "position",
  "left",
  "top",
  "display",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "padding",
  "width",
  "height",
  "flex",
  "flex-shrink",
  "align-self",
  "min-width",
  "overflow",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "box-shadow",
  "opacity",
  "filter",
  "transform-origin",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "text-shadow",
  "white-space",
  "object-fit",
] as const;

const rank = (prop: string): number => {
  const index = ORDER.indexOf(prop as (typeof ORDER)[number]);
  return index === -1 ? ORDER.length : index;
};

/** Merge, drop duplicate properties (last wins) and sort into canonical order. */
export const sortDecls = (...lists: readonly (readonly Decl[])[]): Decl[] => {
  const byProp = new Map<string, Decl>();
  for (const decl of lists.flat()) byProp.set(decl[0], decl);
  return [...byProp.values()].sort((a, b) => rank(a[0]) - rank(b[0]));
};

export const camelProp = (prop: string): string =>
  prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
