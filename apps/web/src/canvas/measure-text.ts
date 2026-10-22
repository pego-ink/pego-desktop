import type { Paragraph } from "canvaskit-wasm";
import { resolveColor, resolveNumber, resolveString } from "@pego/doc";
import type { TextMeasurer, TextNode, Variables } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { createLruCache } from "@/canvas/render-cache";

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const NO_WRAP_WIDTH = 100_000;

const paragraphs = createLruCache<Paragraph>(512);

const nearestWeight = (weight: number) =>
  FONT_WEIGHTS.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));

/**
 * Shared paragraph setup for drawing and measuring. `wrapWidth` wraps the text at that width;
 * undefined means a single unwrapped run. Cached by content, so the result must not be deleted
 * by callers.
 */
export const getParagraph = (
  res: CanvasKitResources,
  node: TextNode,
  variables: Variables,
  wrapWidth: number | undefined,
): Paragraph => {
  const { ck, fontMgr, fontFamily } = res;
  const content = resolveString(node.content, variables);
  const color = resolveColor(node.fill, variables) ?? "#000000";
  const size = resolveNumber(node.fontSize, variables, 14);
  const weight = nearestWeight(resolveNumber(node.fontWeight, variables, 400));
  const align = node.textAlign ?? "left";
  const family = node.fontFamily ?? fontFamily;
  const key = JSON.stringify([content, color, size, weight, align, family, wrapWidth]);
  const cached = paragraphs.get(key);
  if (cached) return cached;

  const style = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(color),
      fontFamilies: family === fontFamily ? [family] : [family, fontFamily],
      fontSize: size,
      fontStyle: { weight: { value: weight } },
    },
    textAlign: ck.TextAlign[align === "center" ? "Center" : align === "right" ? "Right" : "Left"],
  });
  const builder = ck.ParagraphBuilder.Make(style, fontMgr);
  builder.addText(content);
  const paragraph = builder.build();
  builder.delete();
  paragraph.layout(wrapWidth ?? NO_WRAP_WIDTH);
  // Shrink an unwrapped run to its natural width so alignment is relative to the text itself.
  if (wrapWidth === undefined) paragraph.layout(Math.ceil(paragraph.getLongestLine()) + 1);
  paragraphs.set(key, paragraph);
  return paragraph;
};

/** CanvasKit-backed measurer. Uses the same paragraph setup as drawing. */
export const createTextMeasurer =
  (res: CanvasKitResources): TextMeasurer =>
  (node, maxWidth, variables) => {
    const paragraph = getParagraph(res, node, variables, maxWidth);
    // Round up so wrapping the text again at its own measured width never breaks a line.
    return { width: Math.ceil(paragraph.getLongestLine()), height: paragraph.getHeight() };
  };
