import { registerToolHandler, useToolPreview, type ToolHandler } from "@/interaction/tool-handlers";
import type { PathExtras } from "@/canvas/render-path-extras";
import { useToolStore } from "@/store/use-tool-store";
import { insertPathNode } from "@/interaction/freehand/create-path-node";
import {
  buildLinePath,
  snapAngle45,
  type FreehandPath,
  type Point,
} from "@/interaction/freehand/geometry";
import { drawPathPreview } from "@/interaction/freehand/preview";

const DRAG_THRESHOLD = 3;
const DEFAULT_LINE_LENGTH = 100;

type Drag = { start: Point; end: Point; dragged: boolean };

const createLineHandler = (tool: "line" | "arrow"): ToolHandler => {
  const arrow = tool === "arrow";
  const extras: PathExtras = {
    strokeCap: "round",
    strokeJoin: "round",
    ...(arrow ? { endMarker: "arrow" } : {}),
  };
  let active: Drag | null = null;

  const shapeOf = (drag: Drag): FreehandPath =>
    buildLinePath(
      drag.start,
      drag.dragged ? drag.end : { x: drag.start.x + DEFAULT_LINE_LENGTH, y: drag.start.y },
    );

  const clear = () => {
    active = null;
    useToolPreview.getState().invalidate();
  };

  return {
    cursor: "crosshair",
    begin: (p) => {
      const startScreen = p.screen;
      const drag: Drag = { start: { ...p.doc }, end: { ...p.doc }, dragged: false };
      active = drag;
      const update = (next: typeof p) => {
        drag.dragged ||=
          Math.hypot(next.screen.x - startScreen.x, next.screen.y - startScreen.y) >=
          DRAG_THRESHOLD;
        drag.end = next.shiftKey ? snapAngle45(drag.start, next.doc) : { ...next.doc };
        useToolPreview.getState().invalidate();
      };
      return {
        move: update,
        up: (next) => {
          update(next);
          const shape = shapeOf(drag);
          clear();
          const id = insertPathNode(drag.start, shape, {
            name: arrow ? "Arrow" : "Line",
            label: arrow ? "Create arrow" : "Create line",
            ...(arrow ? { endMarker: "arrow" as const } : {}),
          });
          if (id) useToolStore.getState().setTool("select");
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
      if (active) drawPathPreview(res, canvas, camera, shapeOf(active), extras);
    },
  };
};

registerToolHandler("line", createLineHandler("line"));
registerToolHandler("arrow", createLineHandler("arrow"));
