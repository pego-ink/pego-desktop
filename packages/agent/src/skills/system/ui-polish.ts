import type { Skill } from "../types";

/*
 * Adapted from better-ui, Copyright (c) 2026 Jakub Krehel, MIT License:
 * https://github.com/jakubkrehel/skills/tree/d01493b0a7b976a74bfcedc80c783d60c7995910/skills/better-ui
 * Only the static rules (surfaces, icons, optical alignment) carry over; its motion and CSS rules do not
 * apply to the canvas.
 */
export const uiPolishSkill: Skill = {
  id: "ui-polish",
  title: "UI polish",
  description: "Detail rules for corners, icons, padding and surfaces that apply to every design.",
  core: true,
  keywords: [],
  styles: [],
  content: `# UI polish

Small geometry that makes a design feel finished, whatever the style. The style decides how surfaces separate (border, shadow, tonal layer, offset); these rules keep that choice consistent and get the details right.

## Concentric corners
When a child with a cornerRadius sits in its parent's corner at an even inset of 24 or less, parent cornerRadius = child radius + padding (+ a uniform stroke width). An avatar of radius 16 in a box with padding 8 needs radius 24, or make the box a pill too. Past 24 of inset each surface keeps its own radius token.

## Optical alignment
A button with a leading icon gets 2 less padding on the icon side: padding [v, 16, v, 14]; a trailing icon mirrors it. Shift a play triangle 1 to 2px toward its point with padding on its container, never with x/y inside a layout frame.

## One treatment per kind of surface
All cards, all panels, all inputs: one treatment each. Where the style lifts a surface with a soft shadow, use a layered ring, not one big blur. Light effects: [{"type":"shadow","color":"#0000000F","x":0,"y":0,"blur":0,"spread":1},{"type":"shadow","color":"#0000000F","x":0,"y":1,"blur":2,"spread":-1},{"type":"shadow","color":"#0000000A","x":0,"y":2,"blur":4,"spread":0}]. Dark: one ring {"type":"shadow","color":"#FFFFFF14","x":0,"y":0,"blur":0,"spread":1}.

## Image edges
Photos (image nodes and image fills) get stroke {"color":"#0000001A","width":1} on light surfaces and #FFFFFF1A on dark. Never a tinted grey or the accent. Skip logos and transparent art.

## Icons beside text
Pego draws lucide icons with a stroke of size / 12: 16 gives 1.33px, 18 gives 1.5px, 24 gives 2px. Beside 400 to 500 text use about 1.25x the font size, at least 16. Beside 600 or bolder use at least 16, and 18 to 20 beside 14 to 16px text. One icon set per surface. State comes from the icon fill ($text-muted by default, $accent or $text when active), never from another icon.

## Rows of cards end together
Cards in one horizontal row get height fill_container: the row hugs the tallest card and the others stretch to it. Never guess a fixed height.

## Symmetric padding
On a painted container top equals bottom and left equals right, unless a divider or header edge is the reason. [20, 20, 4, 20] is a defect.

## Units beside big numbers
A unit next to a large number ("21 mnt", "3 pasien") is a separate, smaller text in $text-muted, bottom-aligned with the number (alignItems end). The number keeps the font the design skill and style give it.

## No visual placeholders
No grey skeleton bars in mockups or product shots; build small real content instead.

## Verify
get_screenshot at scale 2 on corners, buttons and icon-text pairs, then check_layout. Fix every polish warning it reports.`,
  checklist: [
    "Nested corners at an even inset of 24 or less are concentric (parent radius = child radius + padding)",
    "Icons beside text follow its weight: at least 16, and 18 to 20 beside 14 to 16px semibold text",
    "Every surface of one kind (cards, panels, inputs) has the same treatment, as the style says",
    "Cards in one row end at the same height (height fill_container)",
    "Painted containers have symmetric padding per axis",
    "Photos have a 10% black or white edge; no skeleton bars or grey placeholders",
    "check_layout reports no polish warnings (corners, icons, card rows, padding)",
  ],
};
