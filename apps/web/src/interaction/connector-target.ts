import {
  createId,
  findNode,
  type ConnectorNode,
  type Layout,
  type Op,
  type PegoDocument,
} from "@pego/doc";
import { getNodeIndex, hitPath } from "./hit-test";

/**
 * The layer a connector end attaches to under a document point: the screen (top-level layer)
 * by default, or with `deep` (⌘/Ctrl held) the innermost frame or instance under the point,
 * e.g. a button. Connectors are never an end. Null over empty canvas.
 */
export const connectEndAt = (
  doc: PegoDocument,
  layout: Layout,
  point: { x: number; y: number },
  options: { deep?: boolean; pageId?: string | null; tolerance?: number } = {},
): string | null => {
  const trail = hitPath(doc, layout, point.x, point.y, {
    pageId: options.pageId ?? null,
    tolerance: options.tolerance ?? 0,
  });
  if (!trail) return null;
  const index = getNodeIndex(doc);
  const usable = trail.filter((id) => index.get(id)?.type !== "connector");
  if (!options.deep) return usable[0] ?? null;
  const boxes = usable.filter((id) => {
    const type = index.get(id)?.type;
    return type === "frame" || type === "ref";
  });
  return boxes.at(-1) ?? usable.at(-1) ?? null;
};

/** The op that adds a connector from `from` to `to` on `pageId` (on top of the page's layers). */
export const connectOp = (
  doc: PegoDocument,
  pageId: string,
  from: string,
  to: string,
): { op: Op; id: string } | null => {
  if (from === to) return null;
  const name = (id: string) => findNode(doc, id)?.name ?? id;
  const id = createId();
  const node: ConnectorNode = {
    type: "connector",
    id,
    name: `${name(from)} → ${name(to)}`,
    x: 0,
    y: 0,
    from: { id: from },
    to: { id: to },
  };
  return { op: { op: "insert", parentId: pageId, node }, id };
};
