import { findNode } from "@pego/doc";
import { buildNode, createBuildCtx } from "./build";
import { emitHtml } from "./emit-html";
import { emitReact } from "./emit-react";
import { getIconProvider } from "./icons";
import { pascalCase } from "./naming";
import type { CodeExportOptions, ExportFile } from "./types";
import type { PegoDocument } from "@pego/doc";

/**
 * Generate code for a node and its subtree.
 * react-tailwind: one component per file (the node, plus one per component it instantiates) and
 * a `styles.css` with the Tailwind v4 `@theme` tokens. html-css: `index.html` + `styles.css`.
 */
export const exportCode = (
  doc: PegoDocument,
  nodeId: string,
  options: CodeExportOptions,
): ExportFile[] => {
  const root = findNode(doc, nodeId);
  if (!root) throw new Error(`Unknown node: ${nodeId}`);
  const inlineRefs = options.format === "html-css";
  const rootName = pascalCase(root.name ?? "", "Design");
  const icons = options.icons ?? getIconProvider();
  const ctx = createBuildCtx(
    doc,
    options.layout,
    inlineRefs,
    root,
    rootName,
    icons ? (name) => icons(name) !== undefined : undefined,
  );
  const ir = buildNode(root, { kind: "root" }, ctx, undefined, 0);
  if (!ir) throw new Error(`Node ${nodeId} cannot be exported`);
  return inlineRefs
    ? emitHtml(ir, root.name ?? rootName, ctx, icons)
    : emitReact(ir, rootName, ctx);
};
