import type { Guide } from "./types";

export const typographyAndColorGuide: Guide = {
  id: "typography-and-color",
  title: "Typography and color",
  description:
    "Type scale, font pairing, line length, contrast (WCAG AA) and restrained use of an accent color.",
  content: `# Typography and color

## Type
- Fonts: any Google Font by family name in fontFamily. Pick one pairing from get_style or choose deliberately: a heading face with character plus a neutral body face (Inter, Geist, DM Sans, Hanken Grotesk, IBM Plex Sans), and a mono face (Geist Mono, IBM Plex Mono, Space Mono) only for data and code. Two families is the norm, three the limit.
- Scale: pick sizes from one scale and reuse them. Web: 12, 14, 16, 20, 28, 40, 56, 72. App: 11, 13, 15, 17, 22, 28, 34. Clear jumps between levels (about 1.25-1.5x), not many near-equal sizes.
- Weights: 400 body, 500 labels and UI, 600-700 headings. Two or three weights per design.
- Body text at least 14px on web (13 in dense tools), 15px on mobile. Never below 11px.
- Line length: 50-75 characters; give paragraphs a width of about 480-640 instead of full-width. Do not center more than 2-3 lines.
- Text needs a fill (a text color) to be visible; set it on every text node, preferably $text or $text-muted.
- Do not set a text height. Give text a width (number or fill_container) so it wraps; check_layout flags text that needs more room than a fixed height gives.
- Avoid wide-tracked uppercase labels and monospace headings unless the brand calls for it.

## Color
- Build from roles: bg, surface, surface-2, border, text, text-muted, accent, on-accent, danger. Two to three core colors plus one accent; neutrals carry most of the screen.
- Accent is for the primary action, selected state and one highlight. Everywhere means nowhere.
- Contrast (WCAG AA): normal text 4.5:1, large text (24px+, or 18.66px+ bold) 3:1, UI boundaries and chart segments 3:1. check_layout measures text against the nearest ancestor fill; fix what it reports by changing the text token or the surface, not by adding boxes.
- Text on $accent uses $on-accent (white or near-black, whichever passes), not $text.
- Muted text still needs 4.5:1. Borders and dividers may be lower contrast because they are decoration.
- Tint neutrals slightly toward the brand hue (warm or cool) for a cohesive feel; pure #000 on pure #fff is harsh, pure gray is lifeless.
- Dark themes: lighter surfaces mean higher elevation; reduce text brightness slightly (off-white) and lower accent chroma instead of reusing the light-mode values.
- Do not default to blue-to-purple gradients, glow, or glass. A gradient or shadow needs a reason (hierarchy, elevation) and appears once or twice at most.
- Never convey meaning by color alone: status gets a label or icon too.

## Radius and effects
Keep a small radius scale ($radius-sm/md/lg) and apply by role: inputs and buttons md, cards lg, tags sm. Do not make everything a pill.`,
};
