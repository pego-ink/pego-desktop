import type { Guide } from "./types";

export const landingPageGuide: Guide = {
  id: "landing-page",
  title: "Landing pages",
  description:
    "Narrative arc, hero, section rhythm and conversion rules for marketing and promo pages.",
  content: `# Landing pages

## Purpose
One page, one action (sign up, buy, book a demo). Every section moves the visitor toward it. Write the message first; let the words drive the layout.

## Page frame
- Width 1440, layout vertical, height fit_content, gap 0. Each section is a frame with width fill_container, padding [96, 80] (desktop), and its own inner content frame (max readable width 1120-1200: a frame with width 1200 centered via alignItems center on the section).
- Mobile variant: 390 wide, padding [56, 20], single column, same copy.

## Narrative arc
Promise (hero), proof, how it works or what it does, trust, action. Include only sections the product has content for: no testimonials without real quotes, no logo bar without real customers, no pricing without prices.

## Hero
- One headline stating the outcome (transformation beats benefit beats feature), one sentence of support, one primary button and at most one secondary action.
- Headline 56-88px, weight 600-700, line length under about 14 words, max 2-3 lines; support text 18-20px in $text-muted, width 560-640.
- Pair with one strong visual: a real product screen built with Pego frames, a photo, or large type. Do not draw illustrations from shapes.
- Left-aligned text with a visual on the right, or centered with the visual below; pick one axis per section and keep it.

## Rhythm
- Alternate dense and airy sections; alternate light and dark ($bg and $surface-2, or one inverted section). Avoid five identical centered title + 3-card grids in a row.
- Vary composition: split text/visual, full-width statement, bento of unequal tiles, a long list with large numerals.
- Section title 36-48px, body 16-18px, never below 14px. Do not center more than 2-3 lines of text.

## Conversion
- The primary button is the most prominent element and uses $accent; reserve $accent for actions and one or two key highlights.
- Repeat the call to action at the end with a short, specific line.
- Pricing: highlight the tier that serves the goal, only if one deserves it.

## Copy
Specific over generic ("Cut review time from 2 days to 2 hours" over "Supercharge your workflow"). No buzzword stacks, no decorative emoji, no "AI-powered" badges.`,
};
