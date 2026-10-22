import { resolveNumber, type PathNode, type PegoDocument } from "@pego/doc";
import { translateContours, type Contour, type Pt } from "./anchors";
import { boundsOfContours } from "./bezier";
import { serializeContours } from "./svg-path";

const round2 = (v: number) => Math.round(v * 100) / 100;

export const DEFAULT_STROKE_COLOR = "#1B1B21";
export const DEFAULT_CLOSED_FILL = "#D9D9D9";
export const DEFAULT_STROKE_WIDTH = 2;

/** Stroke colour for new paths: the document's `$text` colour variable when present. */
export const defaultStrokeColor = (doc: PegoDocument): string =>
  doc.variables.text?.type === "color" ? "$text" : DEFAULT_STROKE_COLOR;

export type PathGeometryProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  geometry: string;
};

/**
 * Props that place `contours` (document coordinates) as a node: geometry is normalised so the
 * bounding box starts at 0,0 and x/y carry the offset from the parent's origin. In a flex parent
 * the position is layout-driven, so x/y are omitted.
 */
export const pathGeometryProps = (
  contours: readonly Contour[],
  origin: Pt,
  flex: boolean,
): PathGeometryProps | null => {
  const rect = boundsOfContours(contours);
  if (!rect) return null;
  const local = translateContours(contours, -rect.minX, -rect.minY);
  return {
    ...(flex ? {} : { x: round2(rect.minX - origin.x), y: round2(rect.minY - origin.y) }),
    width: Math.max(1, round2(rect.maxX - rect.minX)),
    height: Math.max(1, round2(rect.maxY - rect.minY)),
    geometry: serializeContours(local),
  };
};

/** Absolute (document-space) position of a node's parent origin, from the node's layout box. */
export const parentOriginOf = (
  box: { x: number; y: number },
  node: PathNode,
  doc: PegoDocument,
): Pt => ({
  x: box.x - resolveNumber(node.x, doc.variables, 0),
  y: box.y - resolveNumber(node.y, doc.variables, 0),
});

export const newPathNode = (
  doc: PegoDocument,
  id: string,
  name: string,
  contours: readonly Contour[],
  origin: Pt,
  flex: boolean,
): PathNode | null => {
  const props = pathGeometryProps(contours, origin, flex);
  if (!props) return null;
  const closed = contours.some((c) => c.closed);
  return {
    type: "path",
    id,
    name,
    x: 0,
    y: 0,
    ...props,
    ...(closed ? { fill: DEFAULT_CLOSED_FILL } : {}),
    stroke: { color: defaultStrokeColor(doc), width: DEFAULT_STROKE_WIDTH },
  };
};
