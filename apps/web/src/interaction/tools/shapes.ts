// Polygon + Star tools: drag a box (Shift = equal sides, Alt = from center), release to create
// a closed `path` node fitted to it. Click without drag = 100x100.
import { roundPx, snapEnabled } from "@/interaction/snap";
import type { Canvas as SkCanvas, Path } from "canvaskit-wasm";
import { createId, findNode, type Box, type PegoNode } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { getLayout } from "@/canvas/layout";
import { SELECTION } from "@/canvas/chrome-colors";
import { docToScreen, type Camera } from "@/canvas/types";
import {
  drawBox,
  resolvePlacement,
  toParentSpace,
  uniqueName,
  type Placement,
} from "@/interaction/create-node";
import { hitPath } from "@/interaction/hit-test";
import { shapePath, shapePoints, type ShapeKind } from "@/interaction/shape-geometry";
import {
  registerToolHandler,
  useToolPreview,
  type ToolHandler,
  type ToolPointer,
} from "@/interaction/tool-handlers";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";

const DRAG_THRESHOLD = 3;
const DEFAULT_SIZE = 100;
const FILL = "#D9D9D9";
const NAMES: Record<ShapeKind, string> = { polygon: "Polygon", star: "Star" };

let preview: { kind: ShapeKind; box: Box } | null = null;

const setPreview = (next: typeof preview) => {
  preview = next;
  useToolPreview.getState().invalidate();
};

const siblingsOf = (placement: Placement): readonly PegoNode[] => {
  const { doc } = useDocumentStore.getState();
  if (placement.parentId === null) return doc.children;
  const parent = findNode(doc, placement.parentId);
  return parent && (parent.type === "frame" || parent.type === "group") ? parent.children : [];
};

const commitShape = (kind: ShapeKind, placement: Placement, box: Box) => {
  const store = useDocumentStore.getState();
  const id = createId();
  const node: PegoNode = {
    type: "path",
    id,
    name: uniqueName(NAMES[kind], siblingsOf(placement)),
    width: box.width,
    height: box.height,
    fill: FILL,
    geometry: shapePath(kind, box.width, box.height),
    x: 0,
    y: 0,
    ...(placement.flex ? {} : toParentSpace(placement, box.x, box.y)),
  };
  const ok = store.commit([{ op: "insert", parentId: placement.parentId, node }], {
    label: `Create ${NAMES[kind].toLowerCase()}`,
  });
  if (ok) useDocumentStore.getState().select([id]);
};

const drawOutline = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  camera: Camera,
  p: typeof preview,
) => {
  if (!p) return;
  const { ck } = res;
  const topLeft = docToScreen(camera, p.box.x, p.box.y);
  const builder = new ck.PathBuilder();
  let path: Path | null = null;
  const paint = new ck.Paint();
  try {
    shapePoints(p.kind, p.box.width * camera.zoom, p.box.height * camera.zoom).forEach((pt, i) => {
      if (i === 0) builder.moveTo(topLeft.x + pt.x, topLeft.y + pt.y);
      else builder.lineTo(topLeft.x + pt.x, topLeft.y + pt.y);
    });
    builder.close();
    path = builder.detachAndDelete();
    paint.setAntiAlias(true);
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(1.5);
    paint.setColor(ck.parseColorString(SELECTION));
    canvas.drawPath(path, paint);
  } finally {
    paint.delete();
    path?.delete();
  }
};

const makeHandler = (kind: ShapeKind): ToolHandler => ({
  cursor: "crosshair",
  begin: (p: ToolPointer) => {
    const { doc, pageId } = useDocumentStore.getState();
    const layout = getLayout(doc);
    const placement = resolvePlacement(
      doc,
      layout,
      hitPath(doc, layout, p.doc.x, p.doc.y, { pageId }),
      pageId,
    );
    const start = p.doc;
    const startScreen = p.screen;
    let dragged = false;
    const boxFor = (q: ToolPointer): Box =>
      drawBox(start, q.doc, { shift: q.shiftKey, alt: q.altKey });
    return {
      move: (q) => {
        if (
          !dragged &&
          Math.hypot(q.screen.x - startScreen.x, q.screen.y - startScreen.y) < DRAG_THRESHOLD
        )
          return;
        dragged = true;
        setPreview({ kind, box: boxFor(q) });
      },
      up: (q) => {
        const box = dragged
          ? boxFor(q)
          : {
              x: roundPx(start.x, snapEnabled()),
              y: roundPx(start.y, snapEnabled()),
              width: DEFAULT_SIZE,
              height: DEFAULT_SIZE,
            };
        setPreview(null);
        commitShape(kind, placement, box);
        useToolStore.getState().setTool("select");
      },
      cancel: () => setPreview(null),
    };
  },
  deactivate: () => {
    if (preview) setPreview(null);
  },
  renderOverlay: (res, canvas, camera) => {
    if (preview?.kind === kind) drawOutline(res, canvas, camera, preview);
  },
});

registerToolHandler("polygon", makeHandler("polygon"));
registerToolHandler("star", makeHandler("star"));
