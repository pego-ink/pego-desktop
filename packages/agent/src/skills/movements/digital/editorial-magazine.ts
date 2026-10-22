import type { Skill } from "../../types";

/*
 * Sources:
 * - https://madegooddesigns.com/editorial-design-guide/ (editorial design: grids, hierarchy, pacing)
 * - https://cdn.jsdelivr.net/npm/@wrongstack/core@0.295.1/design-kits/editorial/KIT.md (web editorial kit: display serif, 60-75 character measure)
 * - https://skills.cat/skills/educlopez/ui-craft/ui-craft-editorial (drop caps, pull quotes on web; treated as practice, secondary)
 * - Print tradition: Swiss/New York magazine grids, running heads, baseline alignment
 */
export const editorialMagazineSkill: Skill = {
  id: "editorial-magazine",
  title: "Editorial magazine",
  description:
    "Magazine typography and grids on screen: display serif headlines, a strong multi-column system, pull quotes, captions and deliberate pacing.",
  category: "style",
  keywords: [
    "editorial",
    "magazine",
    "magazine layout",
    "editorial design",
    "longform",
    "article layout",
    "pull quote",
    "drop cap",
    "gaya majalah",
    "tata letak majalah",
    "desain editorial",
    "artikel panjang",
    "halaman majalah",
  ],
  styles: ["warm-editorial", "newsprint", "quiet-ink"],
  checklist: [
    "One display serif for headlines and one text face for body; a small sans for labels and captions",
    "Headline is at least 3x body size; hierarchy reads at squint level: headline, deck, byline, body",
    "Body measure is 55-75 characters, line height 1.55-1.7, left-aligned ragged right",
    "Layout uses a 12-column (or 6/8-column) grid with consistent margins; images and text align to column edges",
    "At least one typographic event per screen section: drop cap, pull quote, oversize numeral, or caption block",
    "Captions, bylines and section labels are 12-14 px, consistent, with credit lines present",
    "Pacing varies: full-bleed image, narrow text column, two-column spread, then quiet space",
    "Copy is real editorial text in the user's language; text contrast passes 4.5:1 and check_layout is clean",
  ],
  content: `# Editorial magazine

## Essence
Print magazine craft carried to the screen: The New Yorker's rhythm, Vogue's oversize display type, Swiss-inspired grids, Bloomberg Businessweek's confidence. The idea: typography is the design. Hierarchy, measure, white space and pacing hold attention in long text, so images and ornament are supporting actors. It solves reading fatigue and gives a publication or brand an authored voice. It suits articles, magazines, newsletters, case studies, brand stories and cultural or luxury sites.

## Visual vocabulary
- Grid: 12 columns, margins 80 (desktop), column gap 24. Body text spans 6-7 columns (about 640 wide). Sidebars and captions in 3 columns. Wide images break out to 10-12 columns.
- Type: display serif for headlines (Playfair Display, Fraunces, DM Serif Display, Instrument Serif, Newsreader), text serif for body (Source Serif 4, Lora, Newsreader), sans for labels (Inter, Instrument Sans, Work Sans). Headline 64-120 / lineHeight 1.0-1.1 / tight; deck 22-26 italic; body 18-20 / 1.6; caption 13 sans; label 12 uppercase with light tracking (the one place caps are fine).
- Color: paper #FAF7F2, ink #1A1A1A, muted #6B6560, one accent such as vermilion #D1432B or oxblood #7A1E2C, optional dark section #121212.
- Rules: 1px hairlines between sections; a thick 3px rule under the masthead.
- Shape: radius 0 to 2; images sharp.
- Icons: nearly none; text arrows (Read more with a lucide arrow-right 16) as needed.

## Translating into Pego
- Variables: $paper #FAF7F2, $ink #1A1A1A, $muted #6B6560, $accent #D1432B, $rule #1A1A1A, $margin 80, $gutter 24, $measure 640.
- Page: vertical frame width 1440, padding [0, 80]. Masthead row: label left, wordmark in display serif center-ish (justifyContent space_between), 3px rule below.
- Article opener: section label (12 caps), headline 96 in Playfair Display weight 700 spanning 9 columns, deck 24 italic Newsreader in $muted, byline row 13 sans with a thin rule above; full-width image 1280 x 600 with caption 13 beneath.
- Body: horizontal row: a narrow 3-column frame (author, date, share list as text) and a $measure vertical frame with paragraphs gap 20; drop cap as a separate text node, size 88, weight 700 in $accent, in a row with the first paragraph (width fill_container) set to 3-4 lines tall; pull quote: frame with a 3px left or top stroke $accent, text 40 display serif italic, width 5 columns, breaking the column rhythm.
- Components: Article Card (image, label, headline 28 serif, deck 16), Pull Quote, Caption, Byline.
- Home spread: lead story 2 columns wide plus 3 small stories, hairlines between.

## Pitfalls
- Serif everywhere in the same weight is flat. Mix scale and weight, not many families.
- Do not center body text or use tight tracking on body; headlines only.
- Decorative drop caps and pull quotes on every paragraph are noise; one per section.
- All-caps tracked headings, grey on beige captions and tiny sizes fail legibility.
- Do not drop fake bylines or stats as real; mark placeholders.
- A magazine feel is not a card grid with serif titles; the grid must carry editorial intent.

## Pair with
article, portfolio and landing-page build skills; warm-editorial and newsprint presets.

Fonts: Playfair Display, Fraunces, Newsreader, Source Serif 4, Inter`,
};
