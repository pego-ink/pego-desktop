import {
  imageFitRect,
  isContainer,
  linearGradientPoints,
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
  type TextNode,
} from "@pego/doc";
import {
  DEFAULT_ICON_COLOR,
  escapeXml,
  exportRoot,
  num,
  resolveText,
  textWraps,
  type IconMarkup,
  type ResolvedText,
} from "./shared";

/** One laid-out line of a text node: `x` from the box's left edge, `baseline` from its top. */
export type TextLine = { text: string; x: number; baseline: number };

/** Lines of a text node as the canvas wraps them. `width` is set when the text wraps. */
export type TextLines = (node: TextNode, width: number | undefined) => TextLine[];

export type SvgExportOptions = {
  icon?: IconMarkup;
  /** Line breaking from the real font engine; without it, lines split only at newlines. */
  textLines?: TextLines;
  /** Natural image size of an image fill, for cover/contain; stretch is used when unknown. */
  imageSize?: (src: string) => { width: number; height: number } | null;
};

/** `#rrggbbaa` as an SVG color plus opacity, since many SVG consumers ignore 8-digit hex. */
const splitColor = (hex: string): { color: string; opacity: number } => {
  const h = hex.replace("#", "");
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
  if (full.length === 8) {
    return { color: `#${full.slice(0, 6)}`, opacity: parseInt(full.slice(6), 16) / 255 };
  }
  return { color: `#${full.slice(0, 6)}`, opacity: 1 };
};

const colorAttrs = (name: "fill" | "stroke" | "stop", hex: string): string => {
  const { color, opacity } = splitColor(hex);
  const colorKey = name === "stop" ? "stop-color" : name;
  const opacityKey = name === "stop" ? "stop-opacity" : `${name}-opacity`;
  return `${colorKey}="${color}"${opacity < 1 ? ` ${opacityKey}="${num(opacity)}"` : ""}`;
};

/** Fallback line breaking: newlines only, baselines spaced by the line height. */
const naiveLines = (text: ResolvedText): TextLine[] => {
  const lineHeight = (text.lineHeight > 0 ? text.lineHeight : 1.2) * text.size;
  return text.content.split("\n").map((line, i) => ({
    text: line,
    x: 0,
    baseline: i * lineHeight + (lineHeight + text.size * 0.7) / 2,
  }));
};

class SvgWriter {
  private readonly defs: string[] = [];
  private nextId = 1;

  constructor(
    private readonly doc: PegoDocument,
    private readonly layout: Layout,
    private readonly options: SvgExportOptions,
  ) {}

  private id(prefix: string) {
    return `${prefix}${this.nextId++}`;
  }

  private color(value: string | undefined): string | undefined {
    return resolveColor(value, this.doc.variables);
  }

  definitions(): string {
    return this.defs.length > 0 ? `  <defs>\n${this.defs.join("\n")}\n  </defs>\n` : "";
  }

  /** Fill attributes for a shape; gradients and images are registered in <defs>. */
  private fillAttrs(fill: Fill | undefined, width: number, height: number): string {
    if (fill === undefined) return `fill="none"`;
    if (typeof fill === "string") {
      const color = this.color(fill);
      return color ? colorAttrs("fill", color) : `fill="none"`;
    }
    const id = this.id("paint");
    if (fill.type === "image") {
      const size = this.options.imageSize?.(fill.src);
      const rect = size
        ? imageFitRect(fill.fit, size.width, size.height, width, height)
        : { x: 0, y: 0, width, height };
      this.defs.push(
        `    <pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(width)}" height="${num(height)}"><image href="${fill.src}" x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" preserveAspectRatio="none"/></pattern>`,
      );
      return `fill="url(#${id})"`;
    }
    const stops = fill.stops
      .map(
        (stop) =>
          `<stop offset="${num(stop.position)}" ${colorAttrs("stop", this.color(stop.color) ?? "#00000000")}/>`,
      )
      .join("");
    if (fill.type === "linear") {
      const angle = resolveNumber(fill.angle, this.doc.variables, 180);
      const { start, end } = linearGradientPoints(angle, width, height);
      this.defs.push(
        `    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}">${stops}</linearGradient>`,
      );
    } else {
      const [cx, cy] = fill.center;
      const [rx, ry] = fill.radius;
      this.defs.push(
        `    <radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${num(rx * width)} 0 0 ${num(ry * height)} ${num(cx * width)} ${num(cy * height)})">${stops}</radialGradient>`,
      );
    }
    return `fill="url(#${id})"`;
  }

  /** A filter for shadows and layer blur, or "" when the node has none. */
  private filter(effects: Effect[] | undefined, withBlur: boolean): string {
    if (!effects || effects.length === 0) return "";
    const variables = this.doc.variables;
    const outer: string[] = [];
    const inner: string[] = [];
    const parts: string[] = [];
    effects.forEach((effect, i) => {
      if (effect.type === "blur") return;
      const color = this.color(effect.color);
      if (!color) return;
      const { color: rgb, opacity } = splitColor(color);
      const dx = num(resolveNumber(effect.x, variables, 0));
      const dy = num(resolveNumber(effect.y, variables, 0));
      const sigma = num(resolveNumber(effect.blur, variables, 0) / 2);
      const spread = resolveNumber(effect.spread, variables, 0);
      const result = `s${i}`;
      if (effect.inner) {
        // Source alpha minus its shifted, blurred copy = the band just inside the edge.
        parts.push(
          `<feOffset in="SourceAlpha" dx="${dx}" dy="${dy}" result="${result}o"/>`,
          spread > 0
            ? `<feMorphology in="${result}o" operator="erode" radius="${num(spread)}" result="${result}o"/>`
            : "",
          `<feGaussianBlur in="${result}o" stdDeviation="${sigma}" result="${result}b"/>`,
          `<feComposite in="SourceAlpha" in2="${result}b" operator="arithmetic" k2="1" k3="-1" result="${result}m"/>`,
          `<feFlood flood-color="${rgb}" flood-opacity="${num(opacity)}"/>`,
          `<feComposite in2="${result}m" operator="in" result="${result}"/>`,
        );
        inner.push(result);
      } else {
        parts.push(
          spread > 0
            ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${num(spread)}" result="${result}d"/>`
            : "",
          `<feOffset in="${spread > 0 ? `${result}d` : "SourceAlpha"}" dx="${dx}" dy="${dy}" result="${result}o"/>`,
          `<feGaussianBlur in="${result}o" stdDeviation="${sigma}" result="${result}b"/>`,
          `<feFlood flood-color="${rgb}" flood-opacity="${num(opacity)}"/>`,
          `<feComposite in2="${result}b" operator="in" result="${result}"/>`,
        );
        outer.push(result);
      }
    });
    const blur = withBlur
      ? effects.reduce(
          (sum, effect) =>
            effect.type === "blur" ? sum + resolveNumber(effect.radius, variables, 0) : sum,
          0,
        )
      : 0;
    if (outer.length === 0 && inner.length === 0 && blur <= 0) return "";
    const merged = [...outer, "SourceGraphic", ...inner]
      .map((name) => `<feMergeNode in="${name}"/>`)
      .join("");
    const tail = blur > 0 ? `<feGaussianBlur stdDeviation="${num(blur)}"/>` : "";
    const id = this.id("fx");
    this.defs.push(
      `    <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.filter(Boolean).join("")}<feMerge>${merged}</feMerge>${tail}</filter>`,
    );
    return ` filter="url(#${id})"`;
  }

  private layerBlur(effects: Effect[] | undefined): string {
    if (!effects?.some((effect) => effect.type === "blur")) return "";
    return this.filter(
      effects.filter((effect) => effect.type === "blur"),
      true,
    );
  }

  private strokeAttrs(node: PegoNode): string {
    if (!("stroke" in node) || !node.stroke) return "";
    const color = this.color(node.stroke.color);
    if (!color) return "";
    const sides = resolveSides(node.stroke.width, this.doc.variables, 1);
    if (Array.isArray(node.stroke.width)) return "";
    return ` ${colorAttrs("stroke", color)} stroke-width="${num(sides[0])}"`;
  }

  /** Per-side strokes as rects inside the box edges, clipped to the shape. */
  private sideStrokes(node: PegoNode, box: Box, clipId: string | null): string {
    if (!("stroke" in node) || !node.stroke || !Array.isArray(node.stroke.width)) return "";
    const color = this.color(node.stroke.color);
    if (!color) return "";
    const [top, right, bottom, left] = resolveSides(node.stroke.width, this.doc.variables, 0);
    const { width, height } = box;
    const rects = [
      top > 0 ? [0, 0, width, top] : null,
      bottom > 0 ? [0, height - bottom, width, bottom] : null,
      left > 0 ? [0, 0, left, height] : null,
      right > 0 ? [width - right, 0, right, height] : null,
    ]
      .filter((r): r is number[] => r !== null)
      .map(
        ([x, y, w, h]) =>
          `<rect x="${num(x!)}" y="${num(y!)}" width="${num(w!)}" height="${num(h!)}" ${colorAttrs("fill", color)}/>`,
      )
      .join("");
    return clipId ? `<g clip-path="url(#${clipId})">${rects}</g>` : rects;
  }

  private shapeMarkup(node: PegoNode, box: Box): { shape: string; clip: string } {
    const { width, height } = box;
    if (node.type === "ellipse") {
      const attrs = `cx="${num(width / 2)}" cy="${num(height / 2)}" rx="${num(width / 2)}" ry="${num(height / 2)}"`;
      return { shape: `<ellipse ${attrs}`, clip: `<ellipse ${attrs}/>` };
    }
    const radius =
      node.type === "frame" || node.type === "rectangle"
        ? resolveNumber(node.cornerRadius, this.doc.variables, 0)
        : 0;
    const attrs = `width="${num(width)}" height="${num(height)}"${radius > 0 ? ` rx="${num(radius)}"` : ""}`;
    return { shape: `<rect ${attrs}`, clip: `<rect ${attrs}/>` };
  }

  private textMarkup(node: TextNode, box: Box, indent: string): string {
    const text = resolveText(node, this.doc.variables);
    const lines =
      this.options.textLines?.(node, textWraps(node) ? box.width : undefined) ?? naiveLines(text);
    const anchor = text.align === "center" ? "middle" : text.align === "right" ? "end" : "start";
    const anchorX =
      text.align === "center" ? box.width / 2 : text.align === "right" ? box.width : 0;
    const useAnchor = !this.options.textLines;
    const tspans = lines
      .map(
        (line) =>
          `<tspan x="${num(useAnchor ? anchorX : line.x)}" y="${num(line.baseline)}">${escapeXml(line.text)}</tspan>`,
      )
      .join("");
    const filter = this.filter("effects" in node ? node.effects : undefined, true);
    return `${indent}<text font-family="${escapeXml(text.family)}, sans-serif" font-size="${num(text.size)}" font-weight="${num(text.weight)}"${text.letterSpacing ? ` letter-spacing="${num(text.letterSpacing)}"` : ""}${useAnchor && anchor !== "start" ? ` text-anchor="${anchor}"` : ""} ${colorAttrs("fill", text.color)} xml:space="preserve"${filter}>${tspans}</text>`;
  }

  node(node: PegoNode, parentBox: Box, depth: number, indent: string, isRoot = false): string {
    const box = this.layout.get(node.id);
    if (!box) return "";
    const variables = this.doc.variables;
    const effects = "effects" in node ? node.effects : undefined;
    const transforms = [`translate(${num(box.x - parentBox.x)} ${num(box.y - parentBox.y)})`];
    const rotation = isRoot ? 0 : resolveNumber(node.rotation, variables, 0);
    if (rotation !== 0) transforms.push(`rotate(${num(-rotation)})`);
    const opacity = Math.min(1, Math.max(0, resolveNumber(node.opacity, variables, 1)));
    const name = node.name ? ` data-name="${escapeXml(node.name)}"` : "";
    const groupAttrs = `transform="${transforms.join(" ")}"${opacity < 1 ? ` opacity="${num(opacity)}"` : ""}${name}${this.layerBlur(effects)}`;
    const inner = `${indent}  `;
    const body: string[] = [];

    switch (node.type) {
      case "frame":
      case "rectangle":
      case "ellipse": {
        const { shape, clip } = this.shapeMarkup(node, box);
        const fx = this.filter(effects, false);
        body.push(
          `${inner}${shape} ${this.fillAttrs(node.fill, box.width, box.height)}${this.strokeAttrs(node)}${fx}/>`,
        );
        const needsClip =
          (node.type === "frame" && node.clip) ||
          ("stroke" in node && node.stroke && Array.isArray(node.stroke.width));
        const clipId = needsClip ? this.id("clip") : null;
        if (clipId) this.defs.push(`    <clipPath id="${clipId}">${clip}</clipPath>`);
        const sides = this.sideStrokes(node, box, clipId);
        if (node.type === "frame") {
          const children = this.children(node, box, depth, `${inner}  `);
          if (children) {
            body.push(
              node.clip && clipId
                ? `${inner}<g clip-path="url(#${clipId})">\n${children}\n${inner}</g>`
                : children,
            );
          }
        }
        if (sides) body.push(`${inner}${sides}`);
        break;
      }
      case "group": {
        const children = this.children(node, box, depth, inner);
        if (children) body.push(children);
        break;
      }
      case "path": {
        const viewBox = node.viewBox;
        const scale =
          viewBox && viewBox[2] > 0 && viewBox[3] > 0
            ? ` transform="matrix(${num(box.width / viewBox[2])} 0 0 ${num(box.height / viewBox[3])} ${num((-viewBox[0] * box.width) / viewBox[2])} ${num((-viewBox[1] * box.height) / viewBox[3])})"`
            : "";
        body.push(
          `${inner}<path d="${escapeXml(node.geometry)}"${scale} ${this.fillAttrs(node.fill, box.width, box.height)}${this.strokeAttrs(node)}${scale ? ` vector-effect="non-scaling-stroke"` : ""}${this.filter(effects, false)}/>`,
        );
        break;
      }
      case "text":
        body.push(this.textMarkup(node, box, inner));
        break;
      case "icon": {
        const markup = this.options.icon?.(node.iconName, node.iconSet);
        if (markup && box.width > 0 && box.height > 0) {
          const color =
            (typeof node.fill === "string" ? this.color(node.fill) : undefined) ??
            DEFAULT_ICON_COLOR;
          const { color: rgb, opacity: alpha } = splitColor(color);
          body.push(
            `${inner}<g transform="scale(${num(box.width / 24)} ${num(box.height / 24)})" fill="none" stroke="${rgb}"${alpha < 1 ? ` stroke-opacity="${num(alpha)}"` : ""} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${this.filter(effects, false)}>${markup}</g>`,
          );
        }
        break;
      }
      default:
        break;
    }
    if (body.length === 0) return `${indent}<g ${groupAttrs}/>`;
    return `${indent}<g ${groupAttrs}>\n${body.join("\n")}\n${indent}</g>`;
  }

  private children(node: PegoNode, box: Box, depth: number, indent: string): string {
    if (!isContainer(node)) return "";
    return node.children
      .flatMap((child) => {
        const expanded =
          child.type === "ref"
            ? depth + 1 < MAX_INSTANCE_DEPTH
              ? resolveInstance(this.doc, child)
              : null
            : child;
        const markup = expanded ? this.node(expanded, box, depth + 1, indent) : "";
        return markup ? [markup] : [];
      })
      .join("\n");
  }
}

/**
 * An SVG of one node and its subtree, upright at the origin (like the PNG export). Positions and
 * sizes come from `layout`; pass `textLines` from the same font engine as the canvas so wrapped
 * text breaks where it does on screen.
 */
export const exportSvg = (
  doc: PegoDocument,
  layout: Layout,
  rootId: string,
  options: SvgExportOptions = {},
): string => {
  const { node, box } = exportRoot(doc, layout, rootId);
  const writer = new SvgWriter(doc, layout, options);
  const body = writer.node(node, box, 0, "  ", true);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(box.width)}" height="${num(box.height)}" viewBox="0 0 ${num(box.width)} ${num(box.height)}">
${writer.definitions()}${body}
</svg>
`;
};
