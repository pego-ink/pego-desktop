import { isContainer, resolveColor, resolveNumber } from "@pego/doc";
import type { Box, Layout, PegoDocument, PegoNode, TextNode, Variables } from "@pego/doc";
import type { Camera } from "../canvas/types";

const rotate = (degrees: number) => (degrees === 0 ? "" : ` rotate(${-degrees}deg)`);

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Same snapping as canvas/measure-text.ts so the DOM weight matches the drawn one. */
const nearestWeight = (weight: number) =>
  FONT_WEIGHTS.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));

export type EditorStyle = {
  /** Fixed width in document units when the text wraps, otherwise undefined (grows with content). */
  width: number | undefined;
  /** Full placement (pan, zoom, ancestor and own rotation); use with transform-origin 0 0 at 0,0. */
  transform: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  textAlign: "left" | "center" | "right";
  wraps: boolean;
  /** Outline width in document units so it renders as 1 screen pixel. */
  outlineWidth: number;
};

/** The text-relevant subset of a node; create mode passes defaults for the pending node. */
export type EditorTextProps = Pick<
  TextNode,
  "fontFamily" | "fontSize" | "fontWeight" | "textAlign" | "fill" | "width"
>;

/**
 * CSS for the on-canvas editor. Font metrics stay in document units and the whole element is
 * scaled by the camera zoom, so wrapping matches the CanvasKit paragraph at any zoom.
 */
/** One step from the outermost ancestor down to the edited node. */
export type PlacementStep = {
  /** Offset from the parent's top-left (absolute document position for the first step). */
  x: number;
  y: number;
  /** Counter-clockwise degrees around the step's own top-left. */
  rotation: number;
};

/**
 * Placement of a node as the renderer draws it: translate to the box, rotate around its
 * top-left, repeated down the ancestor chain.
 */
export const buildPlacement = (
  doc: PegoDocument,
  id: string,
  layout: Layout,
): PlacementStep[] | null => {
  const walk = (nodes: readonly PegoNode[], parent: Box | null): PlacementStep[] | null => {
    for (const node of nodes) {
      const box = layout.get(node.id);
      if (!box) continue;
      const step: PlacementStep = {
        x: box.x - (parent?.x ?? 0),
        y: box.y - (parent?.y ?? 0),
        rotation: resolveNumber(node.rotation, doc.variables, 0),
      };
      if (node.id === id) return [step];
      if (!isContainer(node)) continue;
      const rest = walk(node.children, box);
      if (rest) return [step, ...rest];
    }
    return null;
  };
  return walk(doc.children, null);
};

export const deriveEditorStyle = (
  props: EditorTextProps,
  placement: readonly PlacementStep[],
  width: number,
  camera: Camera,
  variables: Variables,
  fallbackColor: string,
): EditorStyle => {
  const wraps = typeof props.width === "number" || props.width === "fill_container";
  const steps = placement
    .map(({ x, y, rotation }) => `translate(${x}px, ${y}px)${rotate(rotation)}`)
    .join(" ");
  return {
    width: wraps ? width : undefined,
    transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom}) ${steps}`,
    fontFamily: props.fontFamily ?? "Inter",
    fontSize: resolveNumber(props.fontSize, variables, 14),
    fontWeight: nearestWeight(resolveNumber(props.fontWeight, variables, 400)),
    color: resolveColor(props.fill, variables) ?? fallbackColor,
    textAlign: props.textAlign ?? "left",
    wraps,
    outlineWidth: 1 / camera.zoom,
  };
};
