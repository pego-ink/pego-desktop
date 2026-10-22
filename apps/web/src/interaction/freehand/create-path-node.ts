import { createId, findNode, type PathNode, type PegoDocument, type PegoNode } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { hitPath } from "@/interaction/hit-test";
import { resolvePlacement, toParentSpace, uniqueName } from "@/interaction/create-node";
import { useDocumentStore } from "@/store/use-document-store";
import type { FreehandPath, Point } from "@/interaction/freehand/geometry";

export const PATH_STROKE = { color: "#FFFFFF", width: 2 } as const;

const siblingsOf = (doc: PegoDocument, parentId: string | null): readonly PegoNode[] => {
  if (parentId === null) return doc.children;
  const parent = findNode(doc, parentId);
  return parent && (parent.type === "frame" || parent.type === "group") ? parent.children : [];
};

/**
 * Insert a stroked `path` node (one undo step) into the frame under `anchor` (doc space), select
 * it and return its id. `shape.x/y` are doc coordinates; they are converted to parent space.
 */
export const insertPathNode = (
  anchor: Point,
  shape: FreehandPath,
  options: { name: string; label: string; endMarker?: PathNode["endMarker"] },
): string | null => {
  const { doc, commit, select, pageId } = useDocumentStore.getState();
  const placement = resolvePlacement(
    doc,
    getLayout(doc),
    hitPath(doc, getLayout(doc), anchor.x, anchor.y, { pageId }),
    pageId,
  );
  const id = createId();
  const node: PathNode = {
    type: "path",
    id,
    name: uniqueName(options.name, siblingsOf(doc, placement.parentId)),
    ...(placement.flex ? { x: 0, y: 0 } : toParentSpace(placement, shape.x, shape.y)),
    width: Math.round(shape.width * 100) / 100,
    height: Math.round(shape.height * 100) / 100,
    geometry: shape.geometry,
    stroke: { ...PATH_STROKE },
    strokeCap: "round",
    strokeJoin: "round",
    ...(options.endMarker ? { endMarker: options.endMarker } : {}),
  };
  const ok = commit([{ op: "insert", parentId: placement.parentId, node }], {
    label: options.label,
  });
  if (!ok) return null;
  select([id]);
  return id;
};
