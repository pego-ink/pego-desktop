import { findRenderedNode, type Layout, type PegoDocument } from "@pego/doc";
import type { ToolImage } from "@pego/agent";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { renderDocument } from "@/canvas/render-document";

/** Anthropic downsizes images above ~1568 px on the long edge, so that is the default cap. */
export const DEFAULT_MAX_IMAGE_SIZE = 1568;
/** Hard ceiling regardless of what the caller asks for (keeps the raster surface small). */
export const HARD_MAX_IMAGE_SIZE = 4096;

export type ImageSize = { width: number; height: number; scale: number };

/**
 * Output pixel size for a box rendered at `scale`, shrunk so the longest side is at most
 * `maxSize` (itself capped at HARD_MAX_IMAGE_SIZE). Both sides stay at least 1 px. `scale` in
 * the result is the factor actually applied to document units.
 */
export const computeImageSize = (
  box: { width: number; height: number },
  options: { scale?: number; maxSize?: number } = {},
): ImageSize => {
  const requested = Number.isFinite(options.scale) && options.scale! > 0 ? options.scale! : 1;
  const maxSize = Math.min(
    HARD_MAX_IMAGE_SIZE,
    Number.isFinite(options.maxSize) && options.maxSize! >= 1
      ? Math.floor(options.maxSize!)
      : DEFAULT_MAX_IMAGE_SIZE,
  );
  const longest = Math.max(box.width, box.height) * requested;
  const scale = longest > maxSize ? maxSize / Math.max(box.width, box.height) : requested;
  return {
    scale,
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
  };
};

/** Base64 of raw bytes without blowing the argument limit of `String.fromCharCode`. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

/**
 * Render one node (and its subtree) to a PNG on a separate raster surface, so it works while
 * the editor canvas is live. The node is drawn as `renderDocument` draws it with `rootId`:
 * upright at the origin, ancestors' transforms/clip/opacity not applied, on the editor's solid
 * background (#141418) so both light and dark content stay readable, unless `background` says
 * otherwise (null = transparent, for exports).
 * Throws on an unknown node, a node without size, or an encoding failure.
 */
export const renderNodeImage = (
  res: CanvasKitResources,
  doc: PegoDocument,
  layout: Layout,
  nodeId: string,
  options: { scale?: number; maxSize?: number; background?: string | null } = {},
): ToolImage => {
  const node = findRenderedNode(doc, nodeId);
  const box = node && layout.get(node.id);
  if (!node || !box) throw new Error(`Unknown node: ${nodeId}`);
  if (box.width <= 0 || box.height <= 0) throw new Error(`Node ${nodeId} has no visible size`);

  const { width, height, scale } = computeImageSize(box, options);
  const surface = res.ck.MakeSurface(width, height);
  if (!surface) throw new Error("could not create an offscreen surface");
  try {
    renderDocument(
      res,
      surface.getCanvas(),
      doc,
      layout,
      { panX: 0, panY: 0, zoom: scale },
      { rootId: nodeId, background: options.background },
    );
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      const bytes = image.encodeToBytes();
      if (!bytes) throw new Error("PNG encoding failed");
      return { mediaType: "image/png", data: bytesToBase64(bytes), width, height };
    } finally {
      image.delete();
    }
  } finally {
    surface.delete();
  }
};
