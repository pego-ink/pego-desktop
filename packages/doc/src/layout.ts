import { resolveInstance } from "./instance";
import { resolveNumber } from "./resolve";
import type { PegoDocument, PegoNode, TextNode } from "./schema";
import { isContainer } from "./tree";

/** Axis-aligned box in absolute document coordinates, before the node's own rotation. */
export type Box = { x: number; y: number; width: number; height: number };

/** Measures a text node. `maxWidth` is set when the text wraps inside a known width. */
export type TextMeasurer = (
  node: TextNode,
  maxWidth: number | undefined,
) => { width: number; height: number };

/** Box per node id, including expanded instance descendants (`<instanceId>/<sourceId>`). */
export type Layout = Map<string, Box>;

/** Refs nested deeper than this are not expanded (guards against self-referencing components). */
export const MAX_INSTANCE_DEPTH = 16;

/** Visit a node and its rendered children, expanding refs. `node` is the expanded form. */
export const walkRendered = (
  doc: PegoDocument,
  nodes: readonly PegoNode[],
  visit: (node: PegoNode, depth: number) => boolean | void,
  depth = 0,
): void => {
  for (const raw of nodes) {
    const node = raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
    if (!node) continue;
    if (visit(node, depth) === false) continue;
    if (isContainer(node)) walkRendered(doc, node.children, visit, depth + 1);
  }
};

const numericSize = (value: PegoNode["width"]): number | undefined =>
  typeof value === "number" ? value : undefined;

/**
 * Compute absolute boxes for every rendered node.
 * v0 stub: absolute positioning only (x/y relative to parent, numeric sizes, measured text).
 * Flex layout, fit_content and fill_container land here without changing the signature.
 */
export const computeLayout = (doc: PegoDocument, measureText: TextMeasurer): Layout => {
  const layout: Layout = new Map();
  const place = (nodes: readonly PegoNode[], originX: number, originY: number, depth: number) => {
    for (const raw of nodes) {
      const node =
        raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
      if (!node) continue;
      const x = originX + resolveNumber(node.x, doc.variables, 0);
      const y = originY + resolveNumber(node.y, doc.variables, 0);
      const width = numericSize(node.width);
      const height = numericSize(node.height);
      const measured = node.type === "text" ? measureText(node, width) : undefined;
      layout.set(node.id, {
        x,
        y,
        width: width ?? measured?.width ?? 0,
        height: height ?? measured?.height ?? 0,
      });
      if (isContainer(node)) place(node.children, x, y, depth + 1);
    }
  };
  place(doc.children, 0, 0, 0);
  return layout;
};
