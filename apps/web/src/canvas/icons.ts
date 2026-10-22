import type { CanvasKit, Path, PathBuilder } from "canvaskit-wasm";
import type { Icons, SVGProps } from "lucide";

let iconData: Icons | null = null;

/** Loads the lucide icon data (split into its own chunk). Call before rendering icons. */
export const loadIconData = async (): Promise<void> => {
  if (iconData) return;
  iconData = (await import("lucide")).icons;
};

const toPascalCase = (name: string) =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

const toKebabCase = (pascal: string) =>
  pascal
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();

let iconNames: string[] | null = null;

/**
 * Every renderable lucide icon name in kebab-case, sorted (aliases included). Empty until
 * `loadIconData` has resolved. Only names that round-trip through `getIconPath` are listed.
 */
export const listIconNames = (): string[] => {
  if (!iconData) return [];
  iconNames ??= [
    ...new Set(
      Object.keys(iconData)
        .map(toKebabCase)
        .filter((name) => iconData?.[toPascalCase(name)] !== undefined),
    ),
  ].sort();
  return iconNames;
};

const num = (props: SVGProps, key: string, fallback = 0) => {
  const value = Number(props[key]);
  return Number.isFinite(value) ? value : fallback;
};

const points = (props: SVGProps): number[] =>
  String(props.points ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

const addElement = (ck: CanvasKit, target: PathBuilder, tag: string, props: SVGProps) => {
  switch (tag) {
    case "path": {
      const sub = ck.Path.MakeFromSVGString(String(props.d ?? ""));
      if (!sub) return;
      target.addPath(sub);
      sub.delete();
      return;
    }
    case "circle": {
      const r = num(props, "r");
      target.addOval(ck.XYWHRect(num(props, "cx") - r, num(props, "cy") - r, r * 2, r * 2));
      return;
    }
    case "ellipse": {
      const rx = num(props, "rx");
      const ry = num(props, "ry");
      target.addOval(ck.XYWHRect(num(props, "cx") - rx, num(props, "cy") - ry, rx * 2, ry * 2));
      return;
    }
    case "rect": {
      const rx = num(props, "rx", num(props, "ry"));
      const ry = num(props, "ry", rx);
      const rect = ck.XYWHRect(
        num(props, "x"),
        num(props, "y"),
        num(props, "width"),
        num(props, "height"),
      );
      target.addRRect(ck.RRectXY(rect, rx, ry));
      return;
    }
    case "line": {
      target.moveTo(num(props, "x1"), num(props, "y1"));
      target.lineTo(num(props, "x2"), num(props, "y2"));
      return;
    }
    case "polyline":
    case "polygon":
      target.addPolygon(points(props), tag === "polygon");
      return;
    default:
      return;
  }
};

const iconPaths = new Map<string, Path | null>();

/**
 * 24x24 path for a lucide icon (kebab-case name). Cached for the page lifetime (a few hundred
 * bytes per icon); null when the icon is unknown or the data has not loaded.
 */
export const getIconPath = (ck: CanvasKit, name: string): Path | null => {
  if (!iconData) return null;
  const cached = iconPaths.get(name);
  if (cached !== undefined) return cached;
  const node = iconData[toPascalCase(name)];
  if (!node) {
    iconPaths.set(name, null);
    return null;
  }
  const builder = new ck.PathBuilder();
  node.forEach(([tag, props]) => addElement(ck, builder, tag, props));
  const path = builder.detachAndDelete();
  iconPaths.set(name, path);
  return path;
};

const escapeAttr = (value: unknown) =>
  String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Inner SVG markup of a lucide icon on its 24x24 grid (no `<svg>` wrapper, no stroke attrs), for
 * SVG and HTML export. Null when the icon is unknown or the data has not loaded.
 */
export const getIconMarkup = (name: string): string | null => {
  const node = iconData?.[toPascalCase(name)];
  if (!node) return null;
  return node
    .map(([tag, props]) => {
      const attrs = Object.entries(props)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
        .join("");
      return `<${tag}${attrs}/>`;
    })
    .join("");
};
