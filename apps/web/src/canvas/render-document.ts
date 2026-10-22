import type { Canvas as SkCanvas, CanvasKit, Paint } from "canvaskit-wasm";
import type { Layout, PegoDocument, PegoNode } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { resolveColor, resolveNumber, resolveString } from "@pego/doc";
import type { Camera } from "@/canvas/types";

type Size = { width: number; height: number };

type Scene = {
  res: CanvasKitResources;
  canvas: SkCanvas;
  doc: PegoDocument;
};

const BACKGROUND = "#141418";
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const nodeSize = (node: PegoNode): Size => ({
  width: "width" in node && typeof node.width === "number" ? node.width : 0,
  height: "height" in node && typeof node.height === "number" ? node.height : 0,
});

const withPaint = (ck: CanvasKit, color: string, draw: (paint: Paint) => void) => {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.parseColorString(color));
  try {
    draw(paint);
  } finally {
    paint.delete();
  }
};

const drawText = (scene: Scene, node: Extract<PegoNode, { type: "text" }>) => {
  const { res, canvas, doc } = scene;
  const { ck, fontMgr, fontFamily } = res;
  const weight = resolveNumber(node.fontWeight, doc.variables, 400);
  const nearest = FONT_WEIGHTS.reduce((best, w) =>
    Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
  );
  const paraStyle = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(resolveColor(node.fill, doc.variables) ?? "#000000"),
      fontFamilies: [node.fontFamily ?? fontFamily],
      fontSize: resolveNumber(node.fontSize, doc.variables, 14),
      fontStyle: { weight: { value: nearest } },
    },
    textAlign:
      ck.TextAlign[
        node.textAlign === "center" ? "Center" : node.textAlign === "right" ? "Right" : "Left"
      ],
  });
  const builder = ck.ParagraphBuilder.Make(paraStyle, fontMgr);
  try {
    builder.addText(resolveString(node.content, doc.variables));
    const paragraph = builder.build();
    try {
      paragraph.layout(nodeSize(node).width || 10_000);
      canvas.drawParagraph(paragraph, 0, 0);
    } finally {
      paragraph.delete();
    }
  } finally {
    builder.delete();
  }
};

const drawNode = (scene: Scene, node: PegoNode) => {
  const { res, canvas, doc } = scene;
  const { ck } = res;
  const { width, height } = nodeSize(node);
  const fill = "fill" in node ? resolveColor(node.fill, doc.variables) : undefined;
  const radius = "cornerRadius" in node ? resolveNumber(node.cornerRadius, doc.variables, 0) : 0;

  canvas.save();
  canvas.translate(
    resolveNumber(node.x, doc.variables, 0),
    resolveNumber(node.y, doc.variables, 0),
  );

  switch (node.type) {
    case "frame":
    case "rectangle": {
      if (fill) {
        withPaint(ck, fill, (paint) => {
          canvas.drawRRect(ck.RRectXY(ck.XYWHRect(0, 0, width, height), radius, radius), paint);
        });
      }
      if (node.type === "frame") node.children.forEach((child) => drawNode(scene, child));
      break;
    }
    case "ellipse": {
      if (fill) {
        withPaint(ck, fill, (paint) => {
          canvas.drawOval(ck.XYWHRect(0, 0, width, height), paint);
        });
      }
      break;
    }
    case "group": {
      node.children.forEach((child) => drawNode(scene, child));
      break;
    }
    case "text": {
      drawText(scene, node);
      break;
    }
    // path, icon and ref are not rendered yet.
    default:
      break;
  }

  canvas.restore();
};

/**
 * Draw the document through `camera`. The canvas is expected to already be scaled by
 * devicePixelRatio by the caller. `layout` holds the absolute box of every rendered node.
 */
export const renderDocument = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
) => {
  canvas.clear(res.ck.parseColorString(BACKGROUND));
  void layout; // TODO(renderer): draw from layout boxes instead of raw x/y.
  canvas.save();
  canvas.translate(camera.panX, camera.panY);
  canvas.scale(camera.zoom, camera.zoom);
  doc.children.forEach((node) => drawNode({ res, canvas, doc }, node));
  canvas.restore();
};
