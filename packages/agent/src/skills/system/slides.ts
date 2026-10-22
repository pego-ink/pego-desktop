import type { Skill } from "../types";

export const slidesSkill: Skill = {
  id: "slides",
  title: "Slide decks",
  description: "Presentation decks at 1920x1080: one idea per slide, readable from the back row.",
  keywords: [
    "slides",
    "slide deck",
    "presentation",
    "pitch deck",
    "keynote",
    "deck",
    "presentasi",
    "slide",
    "materi presentasi",
    "pitch",
  ],
  styles: ["bold-block", "warm-editorial", "swiss-grid", "midnight-product", "high-contrast-mono"],
  content: `# Slide decks

Purpose: a visual aid for a speaker, readable on a projector, in Zoom and on a phone. Clarity beats decoration. No speaker notes needed: the slide must still make sense alone.

## Workflow
1. Outline first: one sentence per slide, written as the takeaway. 6-12 slides unless asked.
2. Style from get_style or document variables; adapt it for distance (bigger type, more space).
3. Build components first: Slide Shell (1920x1080, padding 120), Title, Footer/page number, Bullet, Stat. Then each slide as an instance-based frame, placed left to right with find_empty_space (gap 120).
4. After each slide: get_screenshot + check_layout. At the end, view all slides small: the sequence must read as one deck.

## Frame and grid
- Every slide 1920x1080, vertical frame, padding 120 horizontally, 96 vertically. 12-column feel: content width 1680. Keep 100px or more from every edge.
- Same title position, footer and margins on every slide (repetition builds trust).

## Type scale (distance reading)
Cover title 72-96/700, slide title 48-56/600, key statement 56-72, body 28-32, caption and labels 22-24, huge number 160-240. Never below 22. Max two families. Line height 1.1-1.2 titles, 1.35 body. Titles state the takeaway ("Support tickets fell 31% after the redesign"), not the topic ("Results").
If text does not fit at these sizes, split the slide or cut words. Never shrink the font.

## Layout contracts
- Cover: left block, title max 2 lines, subtitle 32, small meta, logo or name bottom right.
- Section break: small muted label + title, huge whitespace.
- Key statement: one sentence, 56-72, max 2 lines, optional attribution.
- Two columns: text 50% (title + max 4 short lines), visual 50%, gap 80, vertically centered.
- Big number: number 200, label 32, one line of context.
- Comparison / list: max 3 columns or 5 rows, never a paragraph. Use a real shape (bars, timeline row) when data is the point.
- Closing: one ask or next step, contact in 32.

## Color
Light or dark background across the entire deck, never mixed by accident. 2-3 colors plus neutrals; accent only on the key word, number or bar. Contrast stricter than usual: aim 7:1 for body.

## Bans
Bullet walls, paragraphs, clip-art, emoji bullets, a different layout on every slide, stock-style gradient backgrounds, shrinking text to fit, charts with 6 series, invented metrics or logos, "Thank you" slides with nothing to act on. Copy in the audience's language.`,
  checklist: [
    "Every slide is 1920x1080 and content stays at least 100px from the edges",
    "One idea per slide; the title states the takeaway",
    "Body text is 28px or larger, nothing below 22px",
    "Title position, margins and footer are identical across slides",
    "No slide has more than 5 list items or a paragraph",
    "Accent color is used only to mark the key element on each slide",
    "Text contrast is at least 7:1 for body text; check_layout is clean",
    "Slides are placed in reading order left to right with equal gaps",
  ],
};
