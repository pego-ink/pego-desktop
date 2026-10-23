import { camelProp } from "./decls";
import { googleFontsUrl } from "./fonts";
import { fontStack } from "./build";
import { iconPascalName } from "./icons";
import { motionStylesheet } from "./motion-css";
import { SHADER_RUNTIME } from "./shader-export";
import type { BuildCtx, IrComponent, IrEl, IrIcon, IrNode, IrUse } from "./ir";
import { cssVarName, kebabCase } from "./naming";
import { fontThemeName, styleObject, toTailwind } from "./tailwind";
import type { ExportFile } from "./types";

const INDENT = "  ";
const MAX_LINE = 100;
const LONG_URL = 200;

type FileState = {
  icons: Set<string>;
  components: Set<string>;
  consts: Map<string, string>;
  constNames: Set<string>;
};

const newState = (): FileState => ({
  icons: new Set(),
  components: new Set(),
  consts: new Map(),
  constNames: new Set(),
});

const SVG_COLOR_ATTRS = new Set(["fill", "stroke", "stop-color"]);

/** Tailwind format defines color variables as `--color-<name>`. */
const tailwindVar = (value: string): string =>
  value.replace(/var\(--([\w-]+)\)/g, "var(--color-$1)");

const attrName = (name: string): string =>
  name.startsWith("aria-") || name.startsWith("data-") ? name : camelProp(name);

const needsExpression = (value: string): boolean => /["&\n\\]/.test(value);

const attrString = (name: string, value: string): string =>
  needsExpression(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;

const textChild = (value: string): string =>
  /[{}<>&\n]|^\s|\s$/.test(value) ? `{${JSON.stringify(value)}}` : value;

const hoistConst = (state: FileState, label: string, value: string): string => {
  for (const [name, existing] of state.consts) if (existing === value) return name;
  const base = `IMG_${kebabCase(label, "image").toUpperCase().replace(/-/g, "_")}`;
  let name = base;
  for (let n = 2; state.constNames.has(name); n++) name = `${base}_${n}`;
  state.constNames.add(name);
  state.consts.set(name, value);
  return name;
};

const lineOf = (depth: number, text: string): string => `${INDENT.repeat(depth)}${text}`;

/** `<tag attrs>` split over lines when it would be too long. */
const tagLines = (
  depth: number,
  name: string,
  attrs: string[],
  close: "open" | "self",
): string[] => {
  const end = close === "self" ? " />" : ">";
  const single = `<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}${end}`;
  if (single.length + depth * INDENT.length <= MAX_LINE || attrs.length <= 1) {
    return [lineOf(depth, single)];
  }
  return [
    lineOf(depth, `<${name}`),
    ...attrs.map((a) => lineOf(depth + 1, a)),
    lineOf(depth, close === "self" ? "/>" : ">"),
  ];
};

type ClassOptions = { asComponentRoot?: boolean };

const classAttrs = (
  decls: IrEl["decls"],
  placement: IrEl["placement"],
  options: ClassOptions,
): string[] => {
  const { classes, style } = toTailwind(decls, options.asComponentRoot ? [] : placement);
  const joined = classes.join(" ");
  const className = options.asComponentRoot
    ? joined
      ? `className={\`${joined} \${className}\`}`
      : "className={className}"
    : joined
      ? `className="${joined}"`
      : "";
  return [className, style.length ? `style={${styleObject(style)}}` : ""].filter(Boolean);
};

const renderUse = (use: IrUse, depth: number, state: FileState): string[] => {
  state.components.add(use.component);
  const { classes } = toTailwind(use.decls);
  const attrs = [
    ...(classes.length ? [`className="${classes.join(" ")}"`] : []),
    ...use.props.map(([name, value]) => attrString(name, value)),
  ];
  return tagLines(depth, use.component, attrs, "self");
};

const renderIcon = (
  icon: IrIcon,
  depth: number,
  state: FileState,
  options: ClassOptions,
): string[] => {
  const name = `${iconPascalName(icon.icon)}Icon`;
  state.icons.add(name);
  const size =
    icon.width === icon.height
      ? [`size={${icon.width}}`]
      : [`width={${icon.width}}`, `height={${icon.height}}`];
  return tagLines(
    depth,
    name,
    [...size, ...classAttrs(icon.decls, icon.placement, options)],
    "self",
  );
};

const renderEl = (
  el: IrEl,
  depth: number,
  state: FileState,
  options: ClassOptions = {},
): string[] => {
  const attrs = [
    ...classAttrs(el.decls, el.placement, options),
    ...el.attrs.map(([name, value]) => {
      if (
        (name === "src" || name === "href") &&
        value.startsWith("data:") &&
        value.length > LONG_URL
      ) {
        return `${name}={${hoistConst(state, el.label, value)}}`;
      }
      const converted = SVG_COLOR_ATTRS.has(name) ? tailwindVar(value) : value;
      return attrString(attrName(name), converted);
    }),
  ];
  const inlineStyle = el.decls.some(([p]) => p === "background-image");
  if (inlineStyle) {
    // Data-URL tiles keep their image in a hoisted constant, not in the style string.
    const index = attrs.findIndex((a) => a.startsWith("style={"));
    const src = el.decls.find(([p]) => p === "background-image")?.[1] ?? "";
    const url = /^url\("(.*)"\)$/.exec(src)?.[1];
    if (index !== -1 && url?.startsWith("data:") && url.length > LONG_URL) {
      const name = hoistConst(state, el.label, url);
      attrs[index] = attrs[index]!.replace(JSON.stringify(src), `\`url("\${${name}}")\``);
    }
  }

  if (el.children.length === 0) return tagLines(depth, el.tag, attrs, "self");
  const [only] = el.children;
  if (el.children.length === 1 && only && (only.kind === "text" || only.kind === "prop")) {
    const text = only.kind === "text" ? textChild(only.value) : `{${only.name}}`;
    const open = tagLines(0, el.tag, attrs, "open");
    if (open.length === 1) {
      const line = lineOf(depth, `${open[0]}${text}</${el.tag}>`);
      if (line.length <= MAX_LINE + 20) return [line];
    }
  }
  return [
    ...tagLines(depth, el.tag, attrs, "open"),
    ...el.children.flatMap((child) => renderNode(child, depth + 1, state)),
    lineOf(depth, `</${el.tag}>`),
  ];
};

const renderNode = (node: IrNode, depth: number, state: FileState): string[] => {
  switch (node.kind) {
    case "el":
      return renderEl(node, depth, state);
    case "icon":
      return renderIcon(node, depth, state, {});
    case "use":
      return renderUse(node, depth, state);
    case "text":
      return [lineOf(depth, textChild(node.value))];
    case "prop":
      return [lineOf(depth, `{${node.name}}`)];
  }
};

const renderRoot = (
  root: IrEl | IrIcon | IrUse,
  depth: number,
  state: FileState,
  asComponentRoot: boolean,
): string[] => {
  if (root.kind === "el") return renderEl(root, depth, state, { asComponentRoot });
  if (root.kind === "icon") return renderIcon(root, depth, state, { asComponentRoot });
  return renderUse(root, depth, state);
};

const header = (state: FileState): string[] => {
  const lines: string[] = [];
  if (state.icons.size > 0) {
    lines.push(`import { ${[...state.icons].sort().join(", ")} } from "lucide-react";`);
  }
  for (const name of [...state.components].sort())
    lines.push(`import { ${name} } from "./${name}";`);
  if (lines.length > 0) lines.push("");
  for (const [name, value] of state.consts) lines.push(`const ${name} = ${JSON.stringify(value)};`);
  if (state.consts.size > 0) lines.push("");
  return lines;
};

const componentSource = (
  name: string,
  root: IrEl | IrIcon | IrUse,
  props: IrComponent["props"] | undefined,
  withClassName: boolean,
  /** The design root starts the shader fills once it is mounted. */
  startShaders = false,
): string => {
  const state = newState();
  const body = renderRoot(root, 2, state, withClassName);
  const names = [...(props ?? []).map((p) => p.name), ...(withClassName ? ["className"] : [])];
  const typeLines = [
    ...(props ?? []).map((p) => `${INDENT}${p.name}?: string;`),
    ...(withClassName ? [`${INDENT}className?: string;`] : []),
  ];
  const destructured = [
    ...(props ?? []).map((p) => `${p.name} = ${JSON.stringify(p.default)}`),
    ...(withClassName ? ['className = ""'] : []),
  ];
  const signature = names.length ? `{ ${destructured.join(", ")} }: ${name}Props` : "";
  const shaderImports = startShaders
    ? ['import { useEffect } from "react";', 'import { startPegoShaders } from "../pego-shaders";']
    : [];
  const head = header(state);
  const lines = [
    ...shaderImports,
    ...(shaderImports.length && !head.length ? [""] : []),
    ...head,
    ...(names.length ? [`type ${name}Props = {`, ...typeLines, "};", ""] : []),
    `export function ${name}(${signature}) {`,
    ...(startShaders ? [lineOf(1, "useEffect(() => startPegoShaders(document), []);")] : []),
    lineOf(1, "return ("),
    ...body,
    lineOf(1, ");"),
    "}",
  ];
  return `${lines.join("\n")}\n`;
};

const stylesheet = (ctx: BuildCtx): string => {
  const url = googleFontsUrl(ctx.fonts);
  const theme: string[] = [];
  for (const [name, variable] of Object.entries(ctx.doc.variables)) {
    if (!ctx.vars.has(name) || variable.type === "string") continue;
    const slug = cssVarName(name);
    theme.push(
      variable.type === "color"
        ? `  --color-${slug}: ${variable.value.toLowerCase()};`
        : `  --${slug}: ${variable.value}px;`,
    );
  }
  for (const family of [...ctx.fonts.keys()].sort()) {
    theme.push(`  --font-${fontThemeName(family)}: ${fontStack(family)};`);
  }
  const motion = motionStylesheet(ctx.motion);
  return [
    ...(url ? [`@import url("${url}");`] : []),
    '@import "tailwindcss";',
    ...(theme.length ? ["", "@theme {", ...theme, "}"] : []),
    ...(motion ? ["", motion] : []),
    "",
  ].join("\n");
};

export const emitReact = (root: IrNode, rootName: string, ctx: BuildCtx): ExportFile[] => {
  const files: ExportFile[] = [];
  const rootNode: IrEl | IrIcon | IrUse =
    root.kind === "el" || root.kind === "icon" || root.kind === "use"
      ? root
      : {
          kind: "el",
          tag: "span",
          label: rootName,
          decls: [],
          placement: [],
          attrs: [],
          children: [root],
        };
  files.push({
    path: `components/${rootName}.tsx`,
    contents: componentSource(rootName, rootNode, undefined, false, ctx.shaders),
  });
  for (const component of ctx.components.values()) {
    files.push({
      path: `components/${component.name}.tsx`,
      contents: componentSource(component.name, component.root, component.props, true),
    });
  }
  files.push({ path: "styles.css", contents: stylesheet(ctx) });
  if (ctx.shaders) {
    files.push({
      path: "pego-shaders.js",
      contents: `/** Draws the design's shader fills (elements with data-pego-shader); returns a stop function. */\nexport const startPegoShaders = ${SHADER_RUNTIME};\n`,
    });
  }
  return files;
};
