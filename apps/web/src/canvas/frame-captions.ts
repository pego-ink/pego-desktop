import { findNode, pageOrFirst, type Layout, type PegoDocument } from "@pego/doc";
import { docToScreen, type Camera } from "./types";

/** Font size, gap above the frame and line height of a caption, in screen pixels. */
export const CAPTION_FONT_SIZE = 11;
export const CAPTION_GAP = 4;
export const CAPTION_HEIGHT = 14;
/** Frames narrower than this on screen get no caption (it would be all ellipsis). */
const MIN_WIDTH = 24;

export type FrameCaption = {
  id: string;
  text: string;
  /** Components and instances are captioned in the component color. */
  kind: "frame" | "component" | "instance";
  /** Top-left of the caption, in screen pixels. */
  x: number;
  y: number;
  /** Room for the text: the frame's width on screen (longer names end in an ellipsis). */
  width: number;
};

/**
 * The name labels above the top-level frames (and instances) of the shown page, like a design
 * tool's artboard titles: what each screen is, at any zoom. Hidden frames get none.
 */
export const frameCaptions = (
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  pageId: string | null,
): FrameCaption[] =>
  pageOrFirst(doc, pageId).children.flatMap((node): FrameCaption[] => {
    if (node.visible === false) return [];
    if (node.type !== "frame" && node.type !== "ref") return [];
    const box = layout.get(node.id);
    if (!box) return [];
    const width = box.width * camera.zoom;
    if (width < MIN_WIDTH) return [];
    const corner = docToScreen(camera, box.x, box.y);
    const component = node.type === "ref" ? findNode(doc, node.ref) : null;
    const text =
      node.name?.trim() || component?.name || (node.type === "ref" ? "Instance" : "Frame");
    return [
      {
        id: node.id,
        text,
        kind: node.type === "ref" ? "instance" : node.reusable ? "component" : "frame",
        x: corner.x,
        y: corner.y - CAPTION_GAP - CAPTION_HEIGHT,
        width,
      },
    ];
  });

/** Rough width of a caption's text (for hit testing; the drawn text is measured exactly). */
const textWidth = (text: string) => text.length * CAPTION_FONT_SIZE * 0.6 + 4;

/** The frame whose caption is at screen point (x, y), or null. The last caption drawn wins. */
export const captionAt = (
  captions: readonly FrameCaption[],
  x: number,
  y: number,
): string | null => {
  for (let index = captions.length - 1; index >= 0; index--) {
    const caption = captions[index]!;
    const right = caption.x + Math.min(caption.width, textWidth(caption.text));
    if (x >= caption.x && x <= right && y >= caption.y && y <= caption.y + CAPTION_HEIGHT) {
      return caption.id;
    }
  }
  return null;
};
