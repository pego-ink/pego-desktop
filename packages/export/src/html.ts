import {
  isContainer,
  MAX_INSTANCE_DEPTH,
  resolveColor,
  resolveInstance,
  resolveNumber,
  resolveSides,
  type Box,
  type Effect,
  type Fill,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type Stroke,
  type Variables,
} from "@pego/doc";
import {
  DEFAULT_ICON_COLOR,
  escapeXml,
  exportRoot,
  num,
  resolveText,
  textWraps,
  type IconMarkup,
} from "./shared";

export type HtmlExportOptions = {
  /** Lucide-style inner SVG markup for icon nodes; icons without markup become empty boxes. */
  icon?: IconMarkup;
  /** `<title>` of the page; defaults to the root node's name. */
  title?: string;
  /** URL to write for an image fill instead of its data URI (e.g. a file name to save it as). */
  imageUrl?: (src: string) => string;
};

type Rule = [property: string, value: string];

/** A `$variable` as a CSS custom property, a literal otherwise. */
const isVariable = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("$");
const cssVar = (value: string) => `var(--${value.slice(1)})`;

const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  space_between: "space-between",
  space_around: "space-around",
};
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };

const kebab = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

class HtmlWriter {
  private readonly rules: string[] = [];
  private readonly classNames = new Map<string, number>();
  readonly fonts = new Map<string, Set<number>>();

  constructor(
    private readonly doc: PegoDocument,
    private readonly layout: Layout,
    private readonly options: HtmlExportOptions,
  ) {}

  private get variables(): Variables {
    return this.doc.variables;
  }

  /** px length: numbers as px, number variables through calc(). */
  private px(value: number | string | undefined, fallback = 0): string {
    if (isVariable(value)) return `calc(${cssVar(value)} * 1px)`;
    return `${num(resolveNumber(value, this.variables, fallback))}px`;
  }

  private color(value: string): string {
    return isVariable(value) ? cssVar(value) : value;
  }

  private className(node: PegoNode): string {
    const base = kebab(node.name ?? "") || node.type;
    const seen = this.classNames.get(base) ?? 0;
    this.classNames.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  }

  css(): string {
    return this.rules.join("\n");
  }

  private gradient(fill: Exclude<Fill, string>): string {
    if (fill.type === "image") {
      const size = fill.fit === "stretch" ? "100% 100%" : fill.fit;
      const url = this.options.imageUrl?.(fill.src) ?? fill.src;
      return `url("${url}") center / ${size} no-repeat`;
    }
    const stops = fill.stops
      .map((stop) => `${this.color(stop.color)} ${num(stop.position * 100)}%`)
      .join(", ");
    if (fill.type === "linear") {
      const angle = isVariable(fill.angle)
        ? `calc(${cssVar(fill.angle)} * 1deg)`
        : `${num(resolveNumber(fill.angle, this.variables, 180))}deg`;
      return `linear-gradient(${angle}, ${stops})`;
    }
    const [cx, cy] = fill.center;
    const [rx, ry] = fill.radius;
    return `radial-gradient(${num(rx * 100)}% ${num(ry * 100)}% at ${num(cx * 100)}% ${num(cy * 100)}%, ${stops})`;
  }

  private shadows(effects: Effect[] | undefined, kind: "box" | "text" | "filter"): string[] {
    if (!effects) return [];
    return effects.flatMap((effect) => {
      if (effect.type !== "shadow") return [];
      const color = this.color(effect.color);
      const xyb = `${this.px(effect.x)} ${this.px(effect.y)} ${this.px(effect.blur)}`;
      if (kind === "box") {
        const spread = effect.spread === undefined ? "" : ` ${this.px(effect.spread)}`;
        return [`${effect.inner ? "inset " : ""}${xyb}${spread} ${color}`];
      }
      // Text and drop-shadow() filters have no spread or inset form.
      if (effect.inner) return [];
      return [kind === "text" ? `${xyb} ${color}` : `drop-shadow(${xyb} ${color})`];
    });
  }

  private blur(effects: Effect[] | undefined): string[] {
    if (!effects) return [];
    return effects.flatMap((effect) =>
      effect.type === "blur" ? [`blur(${this.px(effect.radius)})`] : [],
    );
  }

  /** Uniform strokes are centered outlines (like the canvas); per-side ones are inset shadows. */
  private stroke(stroke: Stroke | undefined): { rules: Rule[]; insets: string[] } {
    if (!stroke) return { rules: [], insets: [] };
    const color = this.color(stroke.color);
    if (!Array.isArray(stroke.width)) {
      return {
        rules: [
          ["outline", `${this.px(stroke.width, 1)} solid ${color}`],
          [
            "outline-offset",
            isVariable(stroke.width)
              ? `calc(${cssVar(stroke.width)} * -0.5px)`
              : `${num(-resolveNumber(stroke.width, this.variables, 1) / 2)}px`,
          ],
        ],
        insets: [],
      };
    }
    const [top, right, bottom, left] = resolveSides(stroke.width, this.variables, 0);
    const insets = [
      top ? `inset 0 ${num(top)}px 0 ${color}` : "",
      right ? `inset ${num(-right)}px 0 0 ${color}` : "",
      bottom ? `inset 0 ${num(-bottom)}px 0 ${color}` : "",
      left ? `inset ${num(left)}px 0 0 ${color}` : "",
    ].filter(Boolean);
    return { rules: [], insets };
  }

  /** Sizing and placement relative to the parent: flex item or absolutely positioned. */
  private placement(node: PegoNode, box: Box, parent: { node: PegoNode; box: Box } | null): Rule[] {
    const rules: Rule[] = [];
    const flexParent =
      parent?.node.type === "frame" && parent.node.layout !== "none" ? parent.node : null;
    const wrapsText = node.type === "text" && textWraps(node);
    const hugText = node.type === "text" && !wrapsText;

    if (!parent) {
      rules.push(["position", "relative"]);
      if (!hugText) rules.push(["width", `${num(box.width)}px`]);
      if (node.type !== "text" || typeof node.height === "number") {
        rules.push(["height", `${num(box.height)}px`]);
      }
    } else if (flexParent) {
      const main = flexParent.layout === "horizontal" ? "width" : "height";
      const cross = main === "width" ? "height" : "width";
      if (node[main] === "fill_container") {
        rules.push(["flex", "1 1 0"], [main === "width" ? "min-width" : "min-height", "0"]);
      } else {
        rules.push(["flex-shrink", "0"]);
        if (typeof node[main] === "number") rules.push([main, this.px(node[main])]);
      }
      if (node[cross] === "fill_container") rules.push(["align-self", "stretch"]);
      else if (typeof node[cross] === "number") rules.push([cross, this.px(node[cross])]);
    } else {
      rules.push(
        ["position", "absolute"],
        ["left", `${num(box.x - parent.box.x)}px`],
        ["top", `${num(box.y - parent.box.y)}px`],
      );
      if (!hugText) rules.push(["width", `${num(box.width)}px`]);
      if (node.type !== "text" || typeof node.height === "number") {
        rules.push(["height", `${num(box.height)}px`]);
      }
    }

    // Containers without flex layout have no intrinsic CSS size; pin them to the computed box.
    const absoluteContainer =
      node.type === "group" || (node.type === "frame" && node.layout === "none");
    if (flexParent && (absoluteContainer || node.type === "icon" || node.type === "path")) {
      const has = (key: string) => rules.some(([property]) => property === key);
      for (const axis of ["width", "height"] as const) {
        if (node[axis] !== "fill_container" && !has(axis)) {
          rules.push([axis, `${num(box[axis])}px`]);
        }
      }
    }
    return rules;
  }

  private styles(node: PegoNode, box: Box, parent: { node: PegoNode; box: Box } | null): Rule[] {
    const rules = this.placement(node, box, parent);
    const effects = "effects" in node ? node.effects : undefined;
    const filters: string[] = [];

    if (node.rotation !== undefined && resolveNumber(node.rotation, this.variables, 0) !== 0) {
      rules.push(
        ["transform", `rotate(${num(-resolveNumber(node.rotation, this.variables, 0))}deg)`],
        ["transform-origin", "0 0"],
      );
    }
    if (node.opacity !== undefined) {
      rules.push([
        "opacity",
        isVariable(node.opacity)
          ? cssVar(node.opacity)
          : num(resolveNumber(node.opacity, this.variables, 1)),
      ]);
    }

    switch (node.type) {
      case "frame":
      case "rectangle":
      case "ellipse": {
        if (node.type === "frame" && node.layout !== "none") {
          rules.push(
            ["display", "flex"],
            ["flex-direction", node.layout === "horizontal" ? "row" : "column"],
            ["justify-content", JUSTIFY[node.justifyContent ?? "start"] ?? "flex-start"],
            ["align-items", ALIGN[node.alignItems ?? "start"] ?? "flex-start"],
          );
          if (node.gap !== undefined) rules.push(["gap", this.px(node.gap)]);
          if (node.padding !== undefined) {
            rules.push([
              "padding",
              Array.isArray(node.padding)
                ? node.padding.map((v) => this.px(v)).join(" ")
                : this.px(node.padding),
            ]);
          }
        }
        if (node.type === "ellipse") rules.push(["border-radius", "50%"]);
        else if (node.cornerRadius !== undefined) {
          rules.push(["border-radius", this.px(node.cornerRadius)]);
        }
        if (node.type === "frame" && node.clip) rules.push(["overflow", "hidden"]);
        if (node.fill !== undefined) {
          rules.push(
            typeof node.fill === "string"
              ? ["background-color", this.color(node.fill)]
              : ["background", this.gradient(node.fill)],
          );
        }
        const stroke = this.stroke(node.stroke);
        rules.push(...stroke.rules);
        const shadows = [...this.shadows(effects, "box"), ...stroke.insets];
        if (shadows.length > 0) rules.push(["box-shadow", shadows.join(", ")]);
        break;
      }
      case "text": {
        const text = resolveText(node, this.variables);
        const weights = this.fonts.get(text.family) ?? new Set<number>();
        weights.add(text.weight);
        this.fonts.set(text.family, weights);
        rules.push(
          [
            "font-family",
            node.fontFamily !== undefined && isVariable(node.fontFamily)
              ? `${cssVar(node.fontFamily)}, system-ui, sans-serif`
              : `"${text.family}", system-ui, sans-serif`,
          ],
          ["font-size", this.px(node.fontSize, text.size)],
          [
            "font-weight",
            isVariable(node.fontWeight) ? cssVar(node.fontWeight) : String(text.weight),
          ],
          ["color", typeof node.fill === "string" ? this.color(node.fill) : text.color],
          ["white-space", textWraps(node) ? "pre-wrap" : "pre"],
          ["margin", "0"],
        );
        if (text.lineHeight > 0) rules.push(["line-height", num(text.lineHeight)]);
        else rules.push(["line-height", "normal"]);
        if (text.letterSpacing !== 0) rules.push(["letter-spacing", this.px(node.letterSpacing)]);
        if (text.align !== "left") rules.push(["text-align", text.align]);
        const shadows = this.shadows(effects, "text");
        if (shadows.length > 0) rules.push(["text-shadow", shadows.join(", ")]);
        break;
      }
      case "icon":
      case "path": {
        rules.push(["display", "block"]);
        filters.push(...this.shadows(effects, "filter"));
        break;
      }
      default:
        break;
    }
    filters.push(...this.blur(effects));
    if (filters.length > 0) rules.push(["filter", filters.join(" ")]);
    return rules;
  }

  private markupOf(node: PegoNode, box: Box): string {
    if (node.type === "text") {
      return escapeXml(resolveText(node, this.variables).content);
    }
    if (node.type === "icon") {
      const inner = this.options.icon?.(node.iconName, node.iconSet) ?? "";
      const color =
        (typeof node.fill === "string" ? resolveColor(node.fill, this.variables) : undefined) ??
        DEFAULT_ICON_COLOR;
      const stroke =
        typeof node.fill === "string" && isVariable(node.fill) ? cssVar(node.fill) : color;
      return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    }
    if (node.type === "path") {
      const viewBox = node.viewBox ?? [0, 0, box.width, box.height];
      const fill = typeof node.fill === "string" ? this.color(node.fill) : "none";
      const stroke = node.stroke && !Array.isArray(node.stroke.width) ? node.stroke : undefined;
      const strokeAttrs = stroke
        ? ` stroke="${escapeXml(this.color(stroke.color))}" stroke-width="${num(resolveNumber(stroke.width as number | string, this.variables, 1))}" vector-effect="non-scaling-stroke"`
        : "";
      return `<svg viewBox="${viewBox.map(num).join(" ")}" width="100%" height="100%" preserveAspectRatio="none" overflow="visible" aria-hidden="true"><path d="${escapeXml(node.geometry)}" fill="${escapeXml(fill)}"${strokeAttrs}/></svg>`;
    }
    return "";
  }

  node(
    node: PegoNode,
    parent: { node: PegoNode; box: Box } | null,
    depth: number,
    indent: string,
  ): string {
    const box = this.layout.get(node.id);
    if (!box) return "";
    const className = this.className(node);
    const rules = this.styles(node, box, parent);
    this.rules.push(
      `.${className} {\n${rules.map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n}`,
    );
    const tag = node.type === "text" ? "p" : "div";
    const label = node.name ? ` data-name="${escapeXml(node.name)}"` : "";
    const open = `${indent}<${tag} class="${className}"${label}>`;
    if (!isContainer(node)) return `${open}${this.markupOf(node, box)}</${tag}>`;

    const children = node.children.flatMap((child) => {
      const expanded =
        child.type === "ref"
          ? depth + 1 < MAX_INSTANCE_DEPTH
            ? resolveInstance(this.doc, child)
            : null
          : child;
      return expanded ? [this.node(expanded, { node, box }, depth + 1, `${indent}  `)] : [];
    });
    if (children.length === 0) return `${open}</${tag}>`;
    return `${open}\n${children.join("\n")}\n${indent}</${tag}>`;
  }
}

const variableCss = (variables: Variables): string => {
  const lines = Object.entries(variables).map(([name, variable]) => {
    const value =
      variable.type === "string" ? JSON.stringify(variable.value) : String(variable.value);
    return `  --${name}: ${value};`;
  });
  return lines.length > 0 ? `:root {\n${lines.join("\n")}\n}\n` : "";
};

const googleFontsLink = (fonts: Map<string, Set<number>>): string => {
  if (fonts.size === 0) return "";
  const families = [...fonts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, weights]) => {
      const list = [...weights].sort((a, b) => a - b).join(";");
      return `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${list}`;
    });
  return `    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.join("&")}&display=swap" />\n`;
};

/**
 * A standalone HTML page (inline `<style>`) for one node and its subtree. Flex frames become
 * flexbox, variables CSS custom properties, gradients and images CSS backgrounds, shadows
 * box-shadow/text-shadow/drop-shadow(). Non-flex placement and hugging sizes come from `layout`,
 * so it must be computed with the same text measurement as the canvas.
 */
export const exportHtml = (
  doc: PegoDocument,
  layout: Layout,
  rootId: string,
  options: HtmlExportOptions = {},
): string => {
  const { node } = exportRoot(doc, layout, rootId);
  const writer = new HtmlWriter(doc, layout, options);
  // The root is exported upright, like the PNG export.
  const body = writer.node({ ...node, rotation: undefined } as PegoNode, null, 0, "    ");
  const title = options.title ?? node.name ?? "Pego export";
  const base = [
    "*, *::before, *::after {\n  box-sizing: border-box;\n}",
    "body {\n  margin: 0;\n}",
  ].join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(title)}</title>
${googleFontsLink(writer.fonts)}    <style>
${variableCss(doc.variables)}${base}
${writer.css()}
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;
};
