import type { Skill } from "../../types";

/*
 * Sources:
 * - https://www.freecodecamp.org/news/bento-grids-in-web-design/ (CSS Grid, spans, gaps)
 * - https://webdesignerdepot.com/?p=2817 (Bento UI trend)
 * - https://studiomeyer.io/en/blog/bento-grid-layouts (hierarchy by tile size; secondary source, treated as practice)
 * - Apple keynote slides and product pages (tile compositions); no primary Apple document describes it as a system
 * Note: origin claims (WWDC 2023, M1 marketing) are unverified in secondary sources; this skill treats it as a layout practice.
 */
export const bentoGridSkill: Skill = {
  id: "bento-grid",
  title: "Bento grid",
  description:
    "Modular tile layout of unequal rounded cells, Apple keynote style: one dominant tile, supporting tiles, consistent gaps.",
  category: "style",
  keywords: [
    "bento grid",
    "bento",
    "bento ui",
    "bento layout",
    "tile layout",
    "apple style grid",
    "modular grid cards",
    "gaya bento",
    "tata letak bento",
    "kotak modular",
    "kartu bento",
  ],
  styles: ["soft-bento", "midnight-product", "sunlit-pastel"],
  checklist: [
    "Grid uses one column unit and one gap (12-16); every tile spans whole cells and edges align",
    "One dominant tile (2x2 or 2x1) carries the main message; no more than 2 large tiles",
    "Tile sizes are unequal but the outer edge of the whole composition is a clean rectangle with no holes",
    "All tiles share one radius (20-28) and one surface style; accents vary by tile fill, not by shape language",
    "Each tile holds one idea: a big number, a short sentence plus visual, or one UI crop",
    "Tile copy is 3-14 words; text size by tile size (large 40+, medium 24, small 16)",
    "Mobile variant stacks to 1-2 columns with the dominant tile first",
    "Contrast of text in every tile is at least 4.5:1 and check_layout is clean",
  ],
  content: `# Bento grid

## Essence
Named after the Japanese lunch box: compartments of different sizes composed into one neat rectangle. In UI it comes from Apple-style keynote and product-page slides, Microsoft's tiled Metro grids earlier and dashboards later (the idea of modular cells is old), and spread through landing pages around 2022-2024. It solves "many features, one screen": size sets rank, so users scan hierarchy without extra labels. It is a layout, not a theme: it works with flat, soft or dark visuals.

## Visual vocabulary
- Grid: 4 columns desktop (cell about 280 in a 1200 frame, gap 16), 2 columns tablet, 1 phone. Rows of 240-280. Spans 1x1, 2x1, 1x2, 2x2.
- Tile: radius 24, padding 24-32, fill from a small family. Light: page #F5F5F7, tile #FFFFFF, ink #1D1D1F, muted #6E6E73. Dark: page #000000, tile #1C1C1E, text #F5F5F7, muted #A1A1A6.
- Accent tiles: 1-2 tiles in the brand color or a tint (#E8F0FE, #FDEBD3), not every tile.
- Type: one family, strong jumps. Inter, Manrope or Instrument Sans: tile title 28-40 / 600, body 16 / 400 muted, big numeral 72-120 / 700.
- Visual: one UI crop, chart, large number or icon cluster per tile. No stock images unless real.
- Icons: lucide stroke 1.5-2, 24-32, in a plain color.

## Translating into Pego
- Variables: $page, $tile, $tile-accent, $ink, $muted, $gap 16, $radius-tile 24, $pad-tile 28.
- Build the grid with nested frames, not x and y: a vertical Grid frame (gap 16) holding horizontal Row frames (gap 16). Equal cells: all children fill_container width with the same weight. A 2x2 dominant tile on the left: Row 1 = [Tall column frame (width 592 = 2 cells + gap, height fill) | cell | cell]; use a vertical frame to stack two 1x1 tiles beside a 1x2 tile. Define cell width W and calculate spans as n*W + (n-1)*gap, and set fixed heights (row 264, tall 544).
- Tile component: frame vertical, padding $pad-tile, radius $radius-tile, fill $tile, clip true; title and body text children; justifyContent space_between so text sits top and visual bottom.
- Hero: headline centered above a 4x3 bento (one 2x2 hero tile with the real product UI, one number tile, one list tile, two small icon tiles). The grid is the hero.
- Sections: a features bento, then a plain testimonial or pricing row so the page rhythm does not repeat tiles.

## Pitfalls
- Every section as a bento is slop: use it once or twice per page.
- Equal tiles are a card grid, not a bento. Without size contrast there is no hierarchy.
- Misaligned spans and uneven gaps break the lunch box illusion; check numbers.
- Do not put paragraphs in tiles; small-screen readers cannot scan them.
- Fake dashboards and invented metrics in tiles are placeholders: label them as sample data.

## Pair with
landing-page, dashboard and pricing build skills; soft-bento preset.

Fonts: Inter, Manrope, Instrument Sans`,
};
