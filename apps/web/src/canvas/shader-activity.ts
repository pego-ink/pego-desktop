import {
  MAX_INSTANCE_DEPTH,
  isContainer,
  resolveInstance,
  shaderIsAnimated,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { findNodePath } from "@/canvas/node-transform";

const movingFill = (node: PegoNode): boolean =>
  "fill" in node &&
  typeof node.fill === "object" &&
  node.fill.type === "shader" &&
  shaderIsAnimated(node.fill);

/** Whether `node` or anything below it (instances included) has a moving shader fill. */
const inSubtree = (doc: PegoDocument, node: PegoNode, depth: number): boolean => {
  const resolved =
    node.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, node) : node;
  if (!resolved || resolved.visible === false) return false;
  if (movingFill(resolved)) return true;
  return isContainer(resolved) && resolved.children.some((c) => inSubtree(doc, c, depth + 1));
};

/**
 * Shader fills move while something they belong to is selected: the selected layer, one of its
 * parents, or something inside it has a shader fill that reads `iTime`.
 */
export const selectionHasMovingShader = (
  doc: PegoDocument,
  selection: readonly string[],
): boolean =>
  selection.some((id) => {
    const path = findNodePath(doc, id);
    if (!path) return false;
    const node = path.at(-1);
    return path.slice(0, -1).some(movingFill) || (node !== undefined && inSubtree(doc, node, 0));
  });
