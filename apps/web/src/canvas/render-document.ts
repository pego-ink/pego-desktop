import type { Canvas as SkCanvas, CanvasKit, Paint } from "canvaskit-wasm";
import type { PegoDocument, PegoNode } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { resolveColor, resolveNumber, resolveString } from "@/canvas/resolve-value";

type Size = { width: number; height: number };

type Scene = {
  res: CanvasKitResources;
  canvas: SkCanvas;
  doc: PegoDocument;
};

const BACKGROUND = "#141418";
const FIT_PADDING = 48;
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

/** Bounds of all top-level nodes, used to fit the document into the viewport. */
const contentBounds = (doc: PegoDocument) =>
  doc.children.reduce(
    (acc, node) => {
      const { width, height } = nodeSize(node);
      const x = resolveNumber(node.x, doc.variables, 0);
      const y = resolveNumber(node.y, doc.variables, 0);
      return {
        minX: Math.min(acc.minX, x),
        minY: Math.min(acc.minY, y),
        maxX: Math.max(acc.maxX, x + width),
        maxY: Math.max(acc.maxY, y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

/**
 * Draw the document, fitted and centered in a viewport of `viewport` CSS pixels.
 * The canvas is expected to already be scaled by devicePixelRatio by the caller.
 */
export const renderDocument = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  viewport: Size,
) => {
  canvas.clear(res.ck.parseColorString(BACKGROUND));
  if (doc.children.length === 0) return;

  const bounds = contentBounds(doc);
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    1,
    (viewport.width - FIT_PADDING * 2) / contentWidth,
    (viewport.height - FIT_PADDING * 2) / contentHeight,
  );
  const safeScale = scale > 0 ? scale : 1;

  canvas.save();
  canvas.translate(
    (viewport.width - contentWidth * safeScale) / 2 - bounds.minX * safeScale,
    (viewport.height - contentHeight * safeScale) / 2 - bounds.minY * safeScale,
  );
  canvas.scale(safeScale, safeScale);
  doc.children.forEach((node) => drawNode({ res, canvas, doc }, node));
  canvas.restore();
};
