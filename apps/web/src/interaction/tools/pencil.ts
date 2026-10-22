import { registerToolHandler, useToolPreview, type ToolPointer } from "@/interaction/tool-handlers";
import { useViewportStore } from "@/store/use-viewport-store";
import { insertPathNode } from "@/interaction/freehand/create-path-node";
import { buildFreehandPath, type FreehandPath, type Point } from "@/interaction/freehand/geometry";
import { drawPathPreview } from "@/interaction/freehand/preview";

/** Final simplification tolerance and minimum sample spacing, in screen px (zoom-aware in doc space). */
const SIMPLIFY_SCREEN_PX = 1.5;
const MIN_SAMPLE_SCREEN_PX = 0.75;

type Stroke = { samples: Point[]; straight: boolean };

let active: Stroke | null = null;

const zoom = () => useViewportStore.getState().camera.zoom;

const preview = (stroke: Stroke): FreehandPath | null =>
  buildFreehandPath(stroke.samples, SIMPLIFY_SCREEN_PX / zoom(), stroke.straight);

const clear = () => {
  active = null;
  useToolPreview.getState().invalidate();
};

const addSample = (stroke: Stroke, p: ToolPointer) => {
  stroke.straight = p.shiftKey;
  const last = stroke.samples[stroke.samples.length - 1];
  const moved =
    !last || Math.hypot(p.doc.x - last.x, p.doc.y - last.y) * zoom() >= MIN_SAMPLE_SCREEN_PX;
  if (moved) stroke.samples.push({ x: p.doc.x, y: p.doc.y });
  useToolPreview.getState().invalidate();
};

registerToolHandler("pencil", {
  cursor: "crosshair",
  begin: (p) => {
    const stroke: Stroke = { samples: [{ x: p.doc.x, y: p.doc.y }], straight: p.shiftKey };
    active = stroke;
    return {
      move: (next) => addSample(stroke, next),
      up: (next) => {
        addSample(stroke, next);
        const shape = preview(stroke);
        const anchor = stroke.samples[0] ?? p.doc;
        clear();
        if (!shape) return;
        // The tool stays active so several strokes can follow.
        insertPathNode(anchor, shape, { name: "Pencil", label: "Draw with pencil" });
      },
      cancel: clear,
    };
  },
  onKeyDown: (e) => {
    if (e.key !== "Escape" || !active) return false;
    clear();
    return true;
  },
  deactivate: clear,
  renderOverlay: (res, canvas, camera) => {
    if (!active) return;
    const shape = preview(active);
    if (shape)
      drawPathPreview(res, canvas, camera, shape, { strokeCap: "round", strokeJoin: "round" });
  },
});
