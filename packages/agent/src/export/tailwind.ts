import { camelProp, sortDecls } from "./decls";
import type { Decl } from "./ir";
import { kebabCase } from "./naming";

export type TailwindResult = { classes: string[]; style: Decl[] };

const VAR = /^var\(--([\w-]+)\)$/;
const PX = /^(-?\d+(?:\.\d+)?)px$/;

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Scale token for a px length (`p-4`), an arbitrary value, or a variable reference. */
const lengthClass = (prefix: string, len: string): string => {
  if (len === "0") return `${prefix}-0`;
  const variable = VAR.exec(len);
  if (variable) return `${prefix}-(--${variable[1]})`;
  const px = PX.exec(len);
  if (!px) return `${prefix}-[${len}]`;
  const n = Number(px[1]);
  const onScale = n % 4 === 0 || (n % 2 === 0 && Math.abs(n) <= 40);
  if (!onScale) return `${prefix}-[${len}]`;
  return n < 0 ? `-${prefix}-${num(-n / 4)}` : `${prefix}-${num(n / 4)}`;
};

const colorClass = (prefix: string, value: string): string => {
  const variable = VAR.exec(value);
  return variable ? `${prefix}-${variable[1]}` : `${prefix}-[${value}]`;
};

const WEIGHTS: Record<string, string> = {
  "100": "font-thin",
  "200": "font-extralight",
  "300": "font-light",
  "400": "font-normal",
  "500": "font-medium",
  "600": "font-semibold",
  "700": "font-bold",
  "800": "font-extrabold",
  "900": "font-black",
};

const RADII: Record<string, string> = {
  "2": "rounded-xs",
  "4": "rounded-sm",
  "6": "rounded-md",
  "8": "rounded-lg",
  "12": "rounded-xl",
  "16": "rounded-2xl",
  "24": "rounded-3xl",
};

const SIMPLE: Record<string, Record<string, string>> = {
  position: { absolute: "absolute", relative: "relative" },
  display: { flex: "flex" },
  "flex-direction": { column: "flex-col" },
  "justify-content": {
    center: "justify-center",
    "flex-end": "justify-end",
    "space-between": "justify-between",
    "space-around": "justify-around",
  },
  "align-items": { "flex-start": "items-start", center: "items-center", "flex-end": "items-end" },
  "align-self": { stretch: "self-stretch" },
  flex: { "1 1 0%": "flex-1" },
  "flex-shrink": { "0": "shrink-0" },
  "min-width": { "0": "min-w-0" },
  overflow: { hidden: "overflow-hidden", visible: "overflow-visible" },
  "transform-origin": { "top left": "origin-top-left" },
  "font-style": { italic: "italic" },
  "line-height": { normal: "leading-[normal]" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right" },
  "white-space": {
    nowrap: "whitespace-nowrap",
    "pre-wrap": "whitespace-pre-wrap",
    pre: "whitespace-pre",
  },
  "object-fit": { cover: "object-cover", contain: "object-contain", none: "object-none" },
};

const sizeClass = (prefix: "w" | "h", value: string): string =>
  value === "100%"
    ? `${prefix}-full`
    : value === "fit-content"
      ? `${prefix}-fit`
      : lengthClass(prefix, value);

const paddingClasses = (value: string): string[] => {
  const t = value.split(" ");
  const cls = (prefix: string, len: string | undefined) =>
    len === undefined || len === "0" ? [] : [lengthClass(prefix, len)];
  if (t.length === 1) return cls("p", t[0]);
  if (t.length === 2) return [...cls("py", t[0]), ...cls("px", t[1])];
  return [...cls("pt", t[0]), ...cls("pr", t[1]), ...cls("pb", t[2]), ...cls("pl", t[3])];
};

const borderClasses = (value: string): string[] => {
  const match = /^(\S+) solid (.+)$/.exec(value);
  if (!match) return [];
  const [, width = "1px", color = "currentColor"] = match;
  const widthClass =
    width === "1px"
      ? "border"
      : /^(2|4|8)px$/.test(width)
        ? `border-${parseInt(width, 10)}`
        : VAR.test(width)
          ? `border-(length:--${VAR.exec(width)![1]})`
          : `border-[${width}]`;
  return [widthClass, colorClass("border", color)];
};

const radiusClass = (value: string): string => {
  if (value === "50%" || value === "9999px") return "rounded-full";
  const variable = VAR.exec(value);
  if (variable) return `rounded-(--${variable[1]})`;
  const px = PX.exec(value);
  return (px && RADII[px[1]!]) || `rounded-[${value}]`;
};

const opacityClass = (value: string): string => {
  const percent = Math.round(Number(value) * 100);
  return Math.abs(percent / 100 - Number(value)) < 1e-9
    ? `opacity-${percent}`
    : `opacity-[${value}]`;
};

const rotateClass = (value: string): string | undefined => {
  const match = /^rotate\((-?\d+(?:\.\d+)?)deg\)$/.exec(value);
  if (!match) return undefined;
  const deg = Number(match[1]);
  if (!Number.isInteger(deg)) return `rotate-[${deg}deg]`;
  return deg < 0 ? `-rotate-${-deg}` : `rotate-${deg}`;
};

const fontClass = (value: string): string => {
  const family = /^"([^"]+)"/.exec(value)?.[1] ?? value;
  return `font-${kebabCase(family, "font")}`;
};

/** Tailwind class for one declaration, or undefined when it needs an inline style. */
const classesFor = ([prop, value]: Decl): string[] | undefined => {
  const simple = SIMPLE[prop]?.[value];
  if (simple) return [simple];
  switch (prop) {
    case "left":
    case "top":
    case "gap":
      return [lengthClass(prop, value)];
    case "width":
      return [sizeClass("w", value)];
    case "height":
      return [sizeClass("h", value)];
    case "padding":
      return paddingClasses(value);
    case "background-color":
      return [colorClass("bg", value)];
    case "color":
      return [colorClass("text", value)];
    case "border":
      return borderClasses(value);
    case "border-radius":
      return [radiusClass(value)];
    case "opacity":
      return [opacityClass(value)];
    case "transform": {
      const cls = rotateClass(value);
      return cls ? [cls] : undefined;
    }
    case "font-family":
      return [fontClass(value)];
    case "font-size": {
      const variable = VAR.exec(value);
      return [variable ? `text-(length:--${variable[1]})` : `text-[${value}]`];
    }
    case "font-weight":
      return [WEIGHTS[value] ?? `font-[${value}]`];
    default:
      return undefined;
  }
};

/** Tailwind classes (canonical order) plus the declarations that have no utility. */
export const toTailwind = (...lists: readonly (readonly Decl[])[]): TailwindResult => {
  const classes: string[] = [];
  const style: Decl[] = [];
  for (const decl of sortDecls(...lists)) {
    const mapped = classesFor(decl);
    if (mapped) classes.push(...mapped);
    else style.push(decl);
  }
  return { classes, style };
};

/** `{ backgroundImage: "..." }` source for a JSX style prop. */
export const styleObject = (style: readonly Decl[]): string =>
  `{ ${style.map(([prop, value]) => `${camelProp(prop)}: ${JSON.stringify(value)}`).join(", ")} }`;

export const fontThemeName = (family: string): string => kebabCase(family, "font");
