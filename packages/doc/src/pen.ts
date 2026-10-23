import { createId } from "./id";
import {
  DOCUMENT_VERSION,
  documentSchema,
  nodeSchema,
  variableSchema,
  type Effect,
  type PegoDocument,
  type PegoNode,
  type Variables,
} from "./schema";

/**
 * Import of Pencil (pen.dev) `.pen` documents. The `.pen` format is JSON close to Pego's own model;
 * this maps the differences (frame layout default, text growth, stroke and effect shapes, icon
 * props, font weights) and reports what cannot be represented instead of failing on it.
 */

export type PenImportWarning = { message: string; count: number };
export type PenImportResult = { doc: PegoDocument; warnings: PenImportWarning[] };

export class PenImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PenImportError";
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Props copied as they are, per Pego node type (after renaming). */
const BASE_KEYS = ["id", "name", "x", "y", "width", "height", "rotation", "opacity", "reusable"];
const PAINT_KEYS = ["fill"];
const KEYS_BY_TYPE: Record<string, readonly string[]> = {
  frame: [
    ...BASE_KEYS,
    ...PAINT_KEYS,
    "cornerRadius",
    "clip",
    "layout",
    "gap",
    "justifyContent",
    "alignItems",
  ],
  group: BASE_KEYS,
  rectangle: [...BASE_KEYS, ...PAINT_KEYS, "cornerRadius"],
  ellipse: [...BASE_KEYS, ...PAINT_KEYS],
  path: [...BASE_KEYS, ...PAINT_KEYS, "geometry", "viewBox"],
  text: [
    ...BASE_KEYS,
    ...PAINT_KEYS,
    "content",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "textAlign",
  ],
  icon: [...BASE_KEYS, ...PAINT_KEYS],
  ref: [...BASE_KEYS, "ref"],
};
/** Props handled by dedicated conversions below. */
const CONVERTED_KEYS = new Set([
  "enabled",
  "type",
  "children",
  "padding",
  "stroke",
  "strokeWidth",
  "effect",
  "fontWeight",
  "textGrowth",
  "icon",
  "library",
  "descendants",
]);
/** Accepted by `.pen` but not meaningful in Pego; dropped without a warning. */
const SILENT_KEYS = new Set(["layoutPosition"]);

const FONT_WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

const SIZING = /^(fill_container|fit_content)(?:\(\s*[\d.]+\s*\))?$/;

class Importer {
  private readonly warnings = new Map<string, number>();
  private readonly ids = new Set<string>();
  private components = new Map<string, Json>();

  warn(message: string) {
    this.warnings.set(message, (this.warnings.get(message) ?? 0) + 1);
  }

  result(): PenImportWarning[] {
    return [...this.warnings].map(([message, count]) => ({ message, count }));
  }

  /** Index reusable nodes so instances that replace descendants can be detached. */
  indexComponents(nodes: unknown[]) {
    for (const node of nodes) {
      if (!isObject(node)) continue;
      if (node.reusable === true && typeof node.id === "string") this.components.set(node.id, node);
      if (Array.isArray(node.children)) this.indexComponents(node.children);
    }
  }

  variables(raw: unknown): Variables {
    if (!isObject(raw)) return {};
    const out: Variables = {};
    for (const [name, value] of Object.entries(raw)) {
      if (!isObject(value)) continue;
      let current = value.value;
      if (Array.isArray(current)) {
        // Themed values: [{ value, theme }, ...]. Pego has no themes yet; keep the first.
        this.warn("Themed variable values: only the first theme was kept");
        current = isObject(current[0]) ? current[0].value : current[0];
      }
      const parsed = variableSchema.safeParse({ type: value.type, value: current });
      if (parsed.success) out[name] = parsed.data;
      else this.warn(`Variable of type "${String(value.type)}" is not supported and was dropped`);
    }
    return out;
  }

  nodes(raw: unknown): PegoNode[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((child) => {
      const node = this.node(child);
      return node ? [node] : [];
    });
  }

  node(raw: unknown): PegoNode | null {
    if (!isObject(raw)) return null;
    if (raw.type === "ref" && this.needsDetach(raw)) {
      const detached = this.detach(raw);
      if (detached) return this.node(detached);
    }
    const type = raw.type === "icon_font" ? "icon" : raw.type;
    const keys = typeof type === "string" ? KEYS_BY_TYPE[type] : undefined;
    if (!keys) {
      this.warn(`Node type "${String(raw.type)}" is not supported and was skipped`);
      return null;
    }

    const out: Json = { type };
    for (const key of keys) if (raw[key] !== undefined) out[key] = raw[key];
    // Pen hides a layer with `enabled: false`.
    if (raw.enabled === false) out.visible = false;
    for (const key of Object.keys(raw)) {
      if (!keys.includes(key) && !CONVERTED_KEYS.has(key) && !SILENT_KEYS.has(key)) {
        this.warn(`Property "${key}" on ${String(type)} is not supported and was dropped`);
      }
    }
    this.sizing(out);
    this.convertProps(raw, out, String(type));

    if (type === "frame" || type === "group") {
      // In .pen a frame without `layout` is a horizontal row; Pego's default is none.
      if (type === "frame" && out.layout === undefined) out.layout = "horizontal";
      out.children = this.nodes(raw.children);
    }
    if (type === "ref" && isObject(raw.descendants)) {
      out.descendants = this.descendants(raw.descendants);
    }
    if (type === "text" && typeof out.content !== "string") out.content = "";

    if (typeof out.id !== "string" || out.id === "" || this.ids.has(out.id)) {
      if (typeof out.id === "string" && out.id !== "") this.warn("Duplicate ids were renamed");
      out.id = createId();
    }
    this.ids.add(out.id as string);

    const parsed = nodeSchema.safeParse(out);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    this.warn(
      `A ${String(type)} could not be converted (${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid"}) and was skipped`,
    );
    return null;
  }

  /** Conversions shared by nodes and descendant overrides. `out` already holds the copied keys. */
  convertProps(raw: Json, out: Json, type: string) {
    if (raw.padding !== undefined) {
      const padding = this.padding(raw.padding);
      if (padding !== undefined) out.padding = padding;
    }
    if (raw.stroke !== undefined || raw.strokeWidth !== undefined) {
      const stroke = this.stroke(raw.stroke, raw.strokeWidth);
      if (stroke) out.stroke = stroke;
    }
    if (raw.effect !== undefined) {
      const effects = this.effects(raw.effect);
      if (effects.length > 0) out.effects = effects;
    }
    if (raw.fontWeight !== undefined) {
      const weight = this.fontWeight(raw.fontWeight);
      if (weight !== undefined) out.fontWeight = weight;
    }
    if (raw.icon !== undefined) out.iconName = raw.icon;
    if (raw.library !== undefined) {
      const library = String(raw.library).toLowerCase();
      if (library !== "lucide")
        this.warn(`Icon library "${library}" is not available; icons may be blank`);
      out.iconSet = library;
    }
    if (type === "text") {
      // auto: hug the text. fixed-width: wrap at the width, hug the height.
      const growth = raw.textGrowth ?? "auto";
      if (growth === "auto") {
        delete out.width;
        delete out.height;
      } else if (growth === "fixed-width") {
        delete out.height;
      }
    }
    if (Array.isArray(out.cornerRadius)) {
      this.warn("Per-corner radius is not supported; the largest corner was used");
      const values = out.cornerRadius.filter((v): v is number => typeof v === "number");
      out.cornerRadius = values.length > 0 ? Math.max(...values) : 0;
    }
    if (out.fill !== undefined && typeof out.fill !== "string") {
      this.warn("Gradient, image and multiple fills are not supported yet and were dropped");
      delete out.fill;
    }
  }

  sizing(out: Json) {
    for (const axis of ["width", "height"] as const) {
      const value = out[axis];
      if (typeof value !== "string" || value.startsWith("$")) continue;
      const match = SIZING.exec(value);
      if (match) out[axis] = match[1];
      else {
        this.warn(`Unsupported ${axis} value "${value}" was dropped`);
        delete out[axis];
      }
    }
  }

  padding(raw: unknown): unknown {
    if (!Array.isArray(raw)) return raw;
    if (raw.length === 1) return raw[0];
    if (raw.length === 2) return [raw[0], raw[1], raw[0], raw[1]];
    if (raw.length === 3) return [raw[0], raw[1], raw[2], raw[1]];
    if (raw.length === 4) return raw;
    this.warn("Malformed padding was dropped");
    return undefined;
  }

  stroke(color: unknown, width: unknown): Json | null {
    if (typeof color !== "string") {
      if (color !== undefined)
        this.warn("Gradient and multiple strokes are not supported and were dropped");
      return null;
    }
    if (width === undefined || typeof width === "number" || typeof width === "string") {
      return { color, width: width ?? 1 };
    }
    if (isObject(width)) {
      const side = (key: string) => (typeof width[key] === "number" ? width[key] : 0);
      return { color, width: [side("top"), side("right"), side("bottom"), side("left")] };
    }
    this.warn("Malformed stroke width was dropped");
    return { color, width: 1 };
  }

  effects(raw: unknown): Effect[] {
    const list = Array.isArray(raw) ? raw : [raw];
    return list.flatMap((effect): Effect[] => {
      if (!isObject(effect)) return [];
      if (effect.enabled === false) return [];
      if (effect.type === "shadow" && typeof effect.color === "string") {
        const offset = isObject(effect.offset) ? effect.offset : {};
        const shadow: Effect = {
          type: "shadow",
          color: effect.color,
          x: typeof offset.x === "number" ? offset.x : 0,
          y: typeof offset.y === "number" ? offset.y : 0,
          blur: typeof effect.blur === "number" ? effect.blur : 0,
        };
        if (typeof effect.spread === "number") shadow.spread = effect.spread;
        if (effect.shadowType === "inner") shadow.inner = true;
        return [shadow];
      }
      if (effect.type === "blur" && typeof effect.radius === "number") {
        return [{ type: "blur", radius: effect.radius }];
      }
      this.warn(`Effect "${String(effect.type)}" is not supported and was dropped`);
      return [];
    });
  }

  fontWeight(raw: unknown): number | string | undefined {
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string") return undefined;
    if (raw.startsWith("$")) return raw;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;
    const named = FONT_WEIGHTS[raw.toLowerCase().replace(/[\s_-]/g, "")];
    if (named === undefined) this.warn(`Font weight "${raw}" was replaced by 400`);
    return named ?? 400;
  }

  /** Override maps use the same prop names as nodes; convert each like a node's props. */
  descendants(raw: Json): Record<string, Json> {
    const out: Record<string, Json> = {};
    for (const [id, props] of Object.entries(raw)) {
      if (!isObject(props)) continue;
      if (id.includes("/")) {
        this.warn("Overrides of nested instance descendants are not supported and were dropped");
        continue;
      }
      const converted: Json = {};
      for (const [key, value] of Object.entries(props)) {
        if (!CONVERTED_KEYS.has(key) && key !== "id") converted[key] = value;
      }
      this.sizing(converted);
      this.convertProps(props, converted, "override");
      if (props.textGrowth !== undefined) {
        this.warn("Text growth overrides are not supported and were dropped");
      }
      out[id] = converted;
    }
    return out;
  }

  /**
   * Pego instances only override position, size and the like on their root, and cannot change a
   * descendant's type. Instances that do more are detached.
   */
  needsDetach(ref: Json): boolean {
    const ownKeys = new Set([...BASE_KEYS, "type", "ref", "descendants"]);
    const replaces =
      isObject(ref.descendants) &&
      Object.values(ref.descendants).some((props) => isObject(props) && props.type !== undefined);
    return replaces || Object.keys(ref).some((key) => !ownKeys.has(key));
  }

  /** A plain copy of the instance's component with its overrides applied (ids prefixed with the ref's id). */
  detach(ref: Json): Json | null {
    const component = typeof ref.ref === "string" ? this.components.get(ref.ref) : undefined;
    if (!component) return null;
    this.warn(
      "Instances that restyle their root or replace a descendant were detached from their component",
    );
    const overrides = isObject(ref.descendants) ? ref.descendants : {};
    const prefix = String(ref.id);

    const copy = (node: Json): Json => {
      const override = isObject(overrides[String(node.id)])
        ? (overrides[String(node.id)] as Json)
        : {};
      const replaced = override.type !== undefined;
      const base = replaced ? override : { ...node, ...override };
      const children = replaced ? base.children : node.children;
      return {
        ...base,
        id: `${prefix}-${String(base.id ?? node.id)}`,
        ...(Array.isArray(children) ? { children: children.filter(isObject).map(copy) } : {}),
      };
    };

    const root = copy(component);
    delete root.id;
    delete root.reusable;
    const refProps = { ...ref };
    for (const key of ["type", "ref", "descendants"]) delete refProps[key];
    return { ...root, ...refProps, type: component.type };
  }
}

/**
 * Convert parsed `.pen` JSON into a Pego document. Throws `PenImportError` when the input is not
 * a `.pen` document at all; everything else that cannot be represented is listed in `warnings`.
 */
export const importPen = (raw: unknown, name = "Imported"): PenImportResult => {
  if (!isObject(raw) || !Array.isArray(raw.children)) {
    throw new PenImportError('Not a .pen document: expected an object with a "children" array.');
  }
  const importer = new Importer();
  importer.indexComponents(raw.children);
  const doc = documentSchema.parse({
    version: DOCUMENT_VERSION,
    id: createId(),
    name,
    variables: importer.variables(raw.variables),
    // .pen has no pages: everything lands on one.
    children: [
      { type: "page", id: createId(), name: "Page 1", children: importer.nodes(raw.children) },
    ],
  });
  if (raw.themes !== undefined)
    importer.warn("Themes are not supported; the default theme was used");
  return { doc, warnings: importer.result() };
};
