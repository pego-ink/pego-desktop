import type { Skill } from "../../types";

/*
 * Sources:
 * - https://www.nngroup.com/articles/flat-design/ (flat design, signifiers, Flat 2.0)
 * - https://en.wikipedia.org/wiki/Metro_(design_language) (Metro principles: typography, motion, content not chrome, honesty)
 * - https://msdn.microsoft.com/en-us/library/Hh974584 (Metro style app guidance, Segoe UI, typography replaces lines and boxes)
 * - https://www.dezeen.com/2013/06/10/new-apple-ios-software-flat-design-jonathan-ive-wwdc/ (iOS 7 launch, Ive on clarity and deference)
 */
export const flatDesignSkill: Skill = {
  id: "flat-design",
  title: "Flat design",
  description:
    "Metro and iOS 7 era: no gloss, no bevels, bold solid color and typography as structure, with enough signifiers to stay usable.",
  category: "style",
  keywords: [
    "flat design",
    "flat ui",
    "flat 2.0",
    "metro",
    "metro ui",
    "modern ui",
    "windows phone",
    "windows 8",
    "ios 7",
    "gaya flat",
    "desain flat",
    "desain datar",
    "tampilan minimalis berwarna",
  ],
  styles: ["bold-block", "playful-rounded", "clinical-light"],
  checklist: [
    "No gradients, bevels or decorative shadows anywhere; depth comes only from color and size",
    "Every clickable element has a signifier: filled color, border, underline or an action verb label; none are text-only by accident",
    "One saturated accent color for actions plus 2-3 supporting flat colors; neutrals carry the rest",
    "Type scale has large contrast (a 40+ title next to 14-16 body) and structure comes from type, not boxes and lines",
    "Tiles or blocks align to one grid unit (for example 8 or 16) with equal gutters",
    "Text on saturated color blocks passes 4.5:1; light-on-yellow and light-on-orange are rejected",
    "Icons are one lucide stroke weight and size family, with labels where meaning is not obvious",
    "check_layout is clean; the screenshot shows a clear primary action at squint level",
  ],
  content: `# Flat design

## Essence
A reaction to a decade of glossy, textured, pseudo-3D interface. Microsoft's Metro (Windows Phone 7, 2010, then Windows 8) set the principles: typography, motion, content not chrome, honesty to the digital medium. Apple's iOS 7 (2013) followed with clarity, deference and depth through layers. Google's Material later added restrained depth ("Flat 2.0"). The problem it solved: heavy ornament slowed screens, aged fast and fought content. The problem it created (NN/g): removing 3D cues removes signifiers, so people hesitate over what is clickable. Good flat design keeps clarity, not just minimalism.

## Visual vocabulary
- Layout: grid of blocks or tiles on a strict unit; content first, little chrome; large pan-style headers (Metro) or clean list rows (iOS 7).
- Type does the structure: big light titles, small clear labels. Metro used Segoe UI; use Open Sans or Source Sans 3 for the humanist feel, Inter for iOS 7 / Helvetica Neue-like clarity, Lato for light display weight.
- Color: flat, saturated, confident. Metro blocks: #0078D7 blue, #E51400 red, #60A917 green, #F0A30A amber, #A200FF purple, #00ABA9 teal. Surfaces #FFFFFF, text #111111, muted #5F6368, dark mode #1F1F1F.
- Shape: Metro is rectangles (radius 0); iOS 7 is soft (radius 12 controls, 22 big cards). Pick one per design.
- Depth: none. Hierarchy from size, weight, color and overlap of flat planes.
- Icons: thin and glyph-like. Lucide stroke 1.5-2, no containers except a color block.

## Translating into Pego
- Variables: $accent #0078D7, $accent-ink #FFFFFF, $surface #FFFFFF, $ink #111111, $muted #5F6368, $tile-a #E51400, $tile-b #60A917, $tile-c #F0A30A, $unit 8, $radius 0 (Metro) or 12 (iOS 7).
- Landing hero: full width $accent frame (padding [96, 80]), headline 72 / weight 300 in white (white on #0078D7 is about 4.5:1; darken to #006CBE for margin), subline 20, one white filled button in $accent ink. Below, a tile row of 3 frames with different $tile colors and sizes 2x1, 1x1, 1x1 using fill_container widths, gap 8.
- App screen: vertical frame, title 40 / weight 300, a Pivot-style row of text tabs (active in $ink, others $muted, no underline needed because color plus weight differ), list rows 64 tall with a 1px stroke separator only where needed.
- Signifiers: primary button filled; secondary button 2px stroke in the accent with accent text; links underlined or colored plus verb label.

## Pitfalls
- Low-contrast ghost buttons and gray text on white are the classic flat failure. A flat screen with several text-only controls is unusable.
- Long shadows, one-off gradients and glossy overlays are not flat; avoid.
- Everything-is-a-colored-tile gets loud; limit the palette and keep one accent for action.
- Color alone must not carry meaning; add icon or text.

## Pair with
dashboard, app screens and landing page build skills (use $unit for grids).

Fonts: Open Sans, Inter, Lato`,
};
