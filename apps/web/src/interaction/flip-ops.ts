import {
  findNode,
  flipOf,
  resolveInstance,
  resolveNumber,
  type Layout,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { invertAffine } from "@/canvas/node-transform";
import { getSelectionFrame, frameCorners } from "./selection-frame";
import { isFlexChild, topmostSelected } from "./transform";

export type FlipAxis = "x" | "y";

/**
 * Shift that moves a span `[start, end]` to its mirror image inside `[min, max]`:
 * the new start is `min + max - end`, so the shift is `(min + max) - (start + end)`.
 */
export const mirrorShift = (min: number, max: number, start: number, end: number): number =>
  min + max - (start + end);

/** What the node shows right now (a ref shows its instance root, which may inherit a flip). */
const isFlipped = (doc: PegoDocument, node: PegoNode, axis: FlipAxis): boolean => {
  const shown = node.type === "ref" ? (resolveInstance(doc, node) ?? node) : node;
  return flipOf(shown)[axis];
};

/** Ids that can be flipped: the topmost selected real nodes (not pages, not instance-internal). */
export const flippableIds = (doc: PegoDocument, ids: readonly string[]): string[] =>
  topmostSelected(
    doc,
    ids.filter((id) => !id.includes("/")),
  ).filter((id) => {
    const node = findNode(doc, id);
    return !!node && node.type !== "page";
  });

/** An angle in degrees folded into (-180, 180], rounded to 1/100°. */
export const normalizeAngle = (degrees: number): number => {
  const folded = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const angle = folded === -180 ? 180 : folded;
  return Math.round(angle * 100) / 100 || 0;
};

/**
 * `update` ops that toggle flipX / flipY on the selected nodes. A multi-selection is mirrored as
 * a whole: each node also moves to the mirrored position inside the selection's bounds (measured
 * on what is drawn, rotation and ancestor transforms included). Flex children keep their slot.
 * A flip is stored as `true`; un-flipping removes the prop (`false` on a ref, so it can also
 * un-flip a flipped component).
 */
export const flipOps = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
  axis: FlipAxis,
): Op[] => {
  const targets = flippableIds(doc, ids);
  const key = axis === "x" ? "flipX" : "flipY";
  const frames = targets.map((id) => ({ id, frame: getSelectionFrame(doc, layout, id) }));
  const nodes = targets.map((id) => findNode(doc, id));

  // Bounds of the drawn shapes, per axis.
  const spans = frames.map(({ frame }) => {
    if (!frame) return null;
    const corners = frameCorners(frame.matrix, frame.box.width, frame.box.height);
    const values = corners.map((c) => (axis === "x" ? c.x : c.y));
    return { start: Math.min(...values), end: Math.max(...values) };
  });
  const valid = spans.filter((span) => span !== null);
  const min = Math.min(...valid.map((s) => s.start));
  const max = Math.max(...valid.map((s) => s.end));

  return frames.flatMap(({ id, frame }, i): Op[] => {
    const node = nodes[i];
    if (!node || node.type === "page") return [];
    const next = !isFlipped(doc, node, axis);
    const props: Record<string, unknown> = {
      [key]: next ? true : node.type === "ref" ? false : null,
    };
    // A visual mirror of R(r)·F is R(-r)·(M·F): a rotated layer also negates its rotation, or
    // an arrow rotated 30° would end up pointing at 210° instead of 150°.
    const rotation = resolveNumber(node.rotation, doc.variables, 0);
    if (rotation % 360 !== 0) props.rotation = normalizeAngle(-rotation);

    const span = spans[i];
    if (targets.length > 1 && span && frame && !isFlexChild(doc, id)) {
      const shift = mirrorShift(min, max, span.start, span.end);
      const inverse = invertAffine(frame.parentMatrix);
      if (inverse && Math.abs(shift) > 1e-9) {
        // The shift is a document-space direction; bring it into the parent's local axes.
        const dx = axis === "x" ? shift : 0;
        const dy = axis === "y" ? shift : 0;
        const localX = inverse.a * dx + inverse.c * dy;
        const localY = inverse.b * dx + inverse.d * dy;
        const round = (n: number) => Math.round(n * 100) / 100;
        props.x = round(resolveNumber(node.x, doc.variables, 0) + localX);
        props.y = round(resolveNumber(node.y, doc.variables, 0) + localY);
      }
    }
    return [{ op: "update", id, props }];
  });
};
