import { sortDecls } from "./decls";
import { googleFontsUrl } from "./fonts";
import type { BuildCtx, Decl, IrEl, IrIcon, IrNode } from "./ir";
import { cssVarName, kebabCase, uniqueName } from "./naming";
import { px } from "./build";
import type { ExportFile, IconProvider } from "./types";

const INDENT = "  ";
const VOID_TAGS = new Set([
  "img",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
]);

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: string): string => escapeText(value).replace(/"/g, "&quot;");

type Rule = { selector: string; decls: Decl[] };

type State = {
  taken: Set<string>;
  rules: Rule[];
  icons: IconProvider | undefined;
  usedLucideFallback: boolean;
};

const attrsToString = (attrs: readonly (readonly [string, string])[]): string =>
  attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join("");

/** Register a CSS rule for the element and return its class attribute. */
const classFor = (state: State, label: string, decls: readonly Decl[]): string => {
  if (decls.length === 0) return "";
  const name = uniqueName(kebabCase(label, "node"), state.taken, "-");
  state.rules.push({ selector: `.${name}`, decls: sortDecls(decls) });
  return ` class="${name}"`;
};

const line = (depth: number, text: string): string => `${INDENT.repeat(depth)}${text}`;

const renderIcon = (icon: IrIcon, depth: number, state: State): string[] => {
  const elements = state.icons?.(icon.icon);
  if (!elements) {
    state.usedLucideFallback = true;
    const cls = classFor(state, icon.label, [
      ...icon.decls,
      ...icon.placement,
      ["width", px(icon.width)],
      ["height", px(icon.height)],
    ]);
    return [line(depth, `<i data-lucide="${escapeAttr(icon.icon)}"${cls}></i>`)];
  }
  const cls = classFor(state, icon.label, [...icon.decls, ...icon.placement]);
  const open = `<svg xmlns="http://www.w3.org/2000/svg"${cls} width="${icon.width}" height="${icon.height}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
  return [
    line(depth, open),
    ...elements.map(([tag, attrs]) => {
      const rendered = Object.entries(attrs)
        .filter(([key, value]) => key !== "key" && value !== undefined)
        .map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
        .join("");
      return line(depth + 1, `<${tag}${rendered} />`);
    }),
    line(depth, "</svg>"),
  ];
};

const renderEl = (el: IrEl, depth: number, state: State): string[] => {
  const cls = classFor(state, el.label, [...el.decls, ...el.placement]);
  const open = `<${el.tag}${cls}${attrsToString(el.attrs)}`;
  if (el.children.length === 0) {
    return [line(depth, VOID_TAGS.has(el.tag) ? `${open} />` : `${open}></${el.tag}>`)];
  }
  const [only] = el.children;
  if (el.children.length === 1 && only?.kind === "text") {
    return [line(depth, `${open}>${escapeText(only.value)}</${el.tag}>`)];
  }
  return [
    line(depth, `${open}>`),
    ...el.children.flatMap((child) => renderNode(child, depth + 1, state)),
    line(depth, `</${el.tag}>`),
  ];
};

const renderNode = (node: IrNode, depth: number, state: State): string[] => {
  switch (node.kind) {
    case "el":
      return renderEl(node, depth, state);
    case "icon":
      return renderIcon(node, depth, state);
    case "text":
      return [line(depth, escapeText(node.value))];
    // html-css expands every instance and has no props.
    case "prop":
    case "use":
      return [];
  }
};

const RESET = `*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
}

h1,
h2,
h3,
p {
  margin: 0;
}

img,
svg {
  display: block;
}
`;

const cssBlock = (rule: Rule): string =>
  `${rule.selector} {\n${rule.decls.map(([p, v]) => `  ${p}: ${v};`).join("\n")}\n}`;

const rootVariables = (ctx: BuildCtx): string => {
  const entries = Object.entries(ctx.doc.variables).flatMap(([name, variable]) => {
    if (!ctx.vars.has(name) || variable.type === "string") return [];
    const value = variable.type === "color" ? variable.value.toLowerCase() : `${variable.value}px`;
    return [`  --${cssVarName(name)}: ${value};`];
  });
  return entries.length ? `:root {\n${entries.join("\n")}\n}\n\n` : "";
};

export const emitHtml = (
  root: IrNode,
  title: string,
  ctx: BuildCtx,
  icons: IconProvider | undefined,
): ExportFile[] => {
  const state: State = { taken: new Set(), rules: [], icons, usedLucideFallback: false };
  const body = renderNode(root, 2, state);
  const fontsUrl = googleFontsUrl(ctx.fonts);
  const head = [
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeText(title)}</title>`,
    ...(fontsUrl
      ? [
          '<link rel="preconnect" href="https://fonts.googleapis.com" />',
          '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
          `<link rel="stylesheet" href="${escapeAttr(fontsUrl)}" />`,
        ]
      : []),
    '<link rel="stylesheet" href="styles.css" />',
  ];
  const scripts = state.usedLucideFallback
    ? [
        line(2, '<script src="https://unpkg.com/lucide@latest"></script>'),
        line(2, "<script>lucide.createIcons();</script>"),
      ]
    : [];
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    line(1, "<head>"),
    ...head.map((h) => line(2, h)),
    line(1, "</head>"),
    line(1, "<body>"),
    ...body,
    ...scripts,
    line(1, "</body>"),
    "</html>",
    "",
  ].join("\n");
  const css = `${rootVariables(ctx)}${RESET}\n${state.rules.map(cssBlock).join("\n\n")}\n`;
  return [
    { path: "index.html", contents: html },
    { path: "styles.css", contents: css },
  ];
};
