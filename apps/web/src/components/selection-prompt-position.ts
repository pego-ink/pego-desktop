type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Gap between the selection corner and the button / box. */
export const ANCHOR_GAP = 6;
/** Keep floating chrome this far inside the canvas viewport. */
export const VIEWPORT_MARGIN = 8;
export const BUTTON_SIZE = 32;
export const PROMPT_WIDTH = 320;
/** Estimated prompt box height, used only to keep it on screen before it is measured. */
export const PROMPT_HEIGHT = 168;

/**
 * Screen corner of a selection where the button hangs: the top-right-most one. For one rotated
 * frame that is the corner maximising x - y; for several frames the corners of all of them are
 * merged into one axis-aligned box first.
 */
export const topRightAnchor = (frames: readonly (readonly Point[])[]): Point | null => {
  const corners = frames.flat();
  if (corners.length === 0) return null;
  if (frames.length === 1)
    return corners.reduce((best, c) => (c.x - c.y > best.x - best.y ? c : best));
  return {
    x: Math.max(...corners.map((c) => c.x)),
    y: Math.min(...corners.map((c) => c.y)),
  };
};

/** True when the corners' bounding box overlaps the viewport (an off-screen selection shows no button). */
export const intersectsViewport = (frames: readonly (readonly Point[])[], viewport: Size) => {
  const corners = frames.flat();
  if (corners.length === 0) return false;
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return (
    Math.max(...xs) >= 0 &&
    Math.min(...xs) <= viewport.width &&
    Math.max(...ys) >= 0 &&
    Math.min(...ys) <= viewport.height
  );
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Top-left of a floating element of `size` placed just outside `anchor` (up and to the right),
 * pulled back inside the viewport. `up` places it above the anchor, otherwise it starts at it.
 */
export const placeAtAnchor = (
  anchor: Point,
  size: Size,
  viewport: Size,
  options: { up?: boolean } = {},
): Point => {
  const rawX = anchor.x + ANCHOR_GAP;
  const rawY = options.up ? anchor.y - ANCHOR_GAP - size.height : anchor.y + ANCHOR_GAP;
  return {
    x: clamp(rawX, VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN),
    y: clamp(rawY, VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN),
  };
};

/**
 * Where the prompt box opens: over the button's spot (so it grows from the button), clamped.
 * `buttonPos` is the button's already clamped top-left.
 */
export const placePromptBox = (buttonPos: Point, size: Size, viewport: Size): Point => ({
  x: clamp(buttonPos.x, VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN),
  y: clamp(buttonPos.y, VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN),
});

export type PromptTarget = { id: string; name: string };

const MAX_PINNED = 12;

/** Prompt sent to the agent: pins the layers so a later selection change cannot retarget it. */
export const buildTargetPrompt = (targets: readonly PromptTarget[], text: string): string => {
  const shown = targets.slice(0, MAX_PINNED).map((t) => `${t.name} (${t.id})`);
  const rest = targets.length - shown.length;
  if (shown.length === 0) return text;
  const list = shown.join(", ") + (rest > 0 ? `, +${rest} more` : "");
  return `Target layers (edit only these unless asked otherwise): ${list}\n\n${text}`;
};

/** "Card, Button +2": the first two names and how many more are selected. */
export const summarizeTargets = (names: readonly string[]): string => {
  const head = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${head} +${names.length - 2}` : head;
};
