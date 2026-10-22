import type { Skill } from "../types";

export const brandIdentitySkill: Skill = {
  id: "brand-identity",
  title: "Brand identity",
  description:
    "Logo explorations, wordmark and symbol lockups, color and type specimens, usage on light and dark.",
  keywords: [
    "logo",
    "brand identity",
    "branding",
    "wordmark",
    "brand guidelines",
    "lockup",
    "identitas brand",
    "identitas merek",
    "merek",
    "desain logo",
    "panduan brand",
  ],
  styles: ["studio-minimal", "swiss-grid", "warm-craft", "high-contrast-mono", "architectural"],
  content: `# Brand identity

Purpose: a recognizable, defensible identity from type, geometry and color. Success: the mark works at 24px and on 3 backgrounds, and the brand still reads with the name hidden.

## Hard rule
Never draw illustration, mascots or detailed symbols with path nodes. Build marks from: type (font choice, custom weight, spacing), geometric primitives (rectangle, ellipse, rotated or clipped frames), lucide icons only as supporting glyphs, never as the logo itself. If the brief needs a drawn symbol, deliver wordmark options and say a designer should draw the symbol.

## Workflow
1. Write the brief in four lines: what it does, who for, three personality words, one thing to avoid. Ask once only if the name is missing.
2. Explore: 6 directions on one board (frames 480x320, gap 40), each with a different font and idea. Test fonts with fontFamily/fontWeight/fontStyle (Google Fonts). Keep real differences, not 6 weights of one idea.
3. Pick one, refine: optical kerning (letterSpacing on text), consistent stroke, one rounded or sharp rule across the mark.
4. Build the system frame set and set_variables for the brand colors; make Lockup a component.
5. get_screenshot each frame, check_layout, shrink the logo to check legibility, focus_nodes.

## Deliverable frames (all labeled, 1440 wide, gap 64)
- Logo: primary lockup (symbol + wordmark horizontal), stacked, symbol only, wordmark only, 4x clear space (clear space equals symbol height / 2) and minimum size (24px symbol, 96px lockup).
- Color: primary, secondary, neutrals, 1 accent; each swatch with name, hex and role; max 5 colors. Show contrast pairs.
- Typography: display + text face, specimen at 72, 40, 20, 14, weights, and a paragraph sample.
- Usage: logo on light, dark, brand color and a photo-free pattern; one correct and 2-3 "do not" (stretch, recolor, low contrast).
- Applications: business card 1050x600, social avatar 400x400 circle crop, favicon 32x32, simple letterhead built with frames and text.

## Craft
- Wordmark: choose a typeface with a distinctive detail, tighten tracking for display (-1% to -3%), lowercase or sentence case unless uppercase is the idea. Customize one letterform trait through a geometric overlay only if clean.
- Symbol: 1 idea, 2 shapes max, constructed on a grid (square or circle base), works in one color first.
- Palette: one dominant color, a neutral pair, a sharp accent; avoid default blue-purple gradients. Check contrast of the logo on every background.
- Weights and sizes in the specimen use a clear scale; labels 12-14 muted.

## Bans
Sparkle or lightning AI symbols, generic swooshes, gradient logos, drop shadows, five fonts, using lucide icons as the logo, invented company claims, tiny unreadable taglines, inconsistent corner radius within the mark.`,
  checklist: [
    "No logo or symbol is drawn with path nodes; marks use type, geometry or icons only",
    "Exploration board shows genuinely different directions, not variations of one",
    "Primary lockup, stacked, symbol-only and wordmark-only are all present and aligned",
    "Logo stays legible at 24px symbol size and has a stated clear space",
    "Palette has at most 5 colors, each with name, hex and role",
    "Type specimen shows display and text faces at a clear scale",
    "Logo is shown on light, dark and brand color with contrast verified",
    "Brand colors exist as variables and the lockup is a component",
  ],
};
