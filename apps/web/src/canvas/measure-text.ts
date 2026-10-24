import { fontVariationsFor } from "@/fonts/variations";
import type { Paragraph } from "canvaskit-wasm";
import { resolveColor, resolveNumber, resolveString } from "@pego/doc";
import type { TextMeasurer, TextNode, Variables } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { useFontEvents } from "@/fonts/font-events";
import { createLruCache } from "@/canvas/render-cache";

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const NO_WRAP_WIDTH = 100_000;

// Large enough for every text of a big page on screen at once (zoomed out over dozens of
// screens): a smaller cache would rebuild paragraphs on every frame while panning.
const paragraphs = createLruCache<Paragraph>(4096);

export const nearestWeight = (weight: number) =>
  FONT_WEIGHTS.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));

/** Cache key of a paragraph: every input that changes its shape, including italic. */
export const paragraphKey = (
  parts: readonly [
    content: string,
    color: string,
    size: number,
    weight: number,
    italic: boolean,
    align: string,
    family: string,
    wrapWidth: number | undefined,
    /** "var" when the face is drawn through a variable-font `wght` axis, else "static". */
    axes?: "var" | "static",
    lineHeight?: number,
    letterSpacing?: number,
  ],
): string => JSON.stringify(parts);

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
  const { ck, fontProvider, fontFamily } = res;
  const content = resolveString(node.content, variables);
  const color = resolveColor(node.fill, variables) ?? "#000000";
  const size = resolveNumber(node.fontSize, variables, 14);
  const weight = nearestWeight(resolveNumber(node.fontWeight, variables, 400));
  const align = node.textAlign ?? "left";
  const family =
    node.fontFamily === undefined ? fontFamily : resolveString(node.fontFamily, variables);
  const italic = node.fontStyle === "italic";
  const variations = fontVariationsFor(family, weight);
  const lineHeight = resolveNumber(node.lineHeight, variables, 0);
  const letterSpacing = resolveNumber(node.letterSpacing, variables, 0);
  // A face that finished loading changes the shape: the font version is part of the key.
  const key = `${useFontEvents.getState().version}|${paragraphKey([
    content,
    color,
    size,
    weight,
    italic,
    align,
    family,
    wrapWidth,
    variations ? ("var" as const) : ("static" as const),
    lineHeight,
    letterSpacing,
  ])}`;
  const cached = paragraphs.get(key);
  if (cached) return cached;

  const style = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(color),
      fontFamilies: family === fontFamily ? [family] : [family, fontFamily],
      fontSize: size,
      fontStyle: {
        weight: { value: weight },
        slant: italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      ...(variations ? { fontVariations: variations } : {}),
      // CSS-like line height: the extra leading is split above and below each line.
      ...(lineHeight > 0 ? { heightMultiplier: lineHeight, halfLeading: true } : {}),
      ...(letterSpacing !== 0 ? { letterSpacing } : {}),
    },
    textAlign: ck.TextAlign[align === "center" ? "Center" : align === "right" ? "Right" : "Left"],
  });
  const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, fontProvider);
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
