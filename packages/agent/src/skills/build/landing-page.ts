import type { Skill } from "../types";

export const landingPageSkill: Skill = {
  id: "landing-page",
  title: "Landing page",
  description:
    "Single conversion page: one promise, proof, one action. Distinctive hero, varied section rhythm, specific copy.",
  keywords: [
    "landing page",
    "homepage",
    "home page",
    "hero",
    "hero section",
    "waitlist page",
    "product page",
    "promo page",
    "halaman landing",
    "landing page produk",
    "website produk",
    "halaman utama",
    "halaman promo",
  ],
  styles: ["warm-editorial", "quiet-ink", "bold-block", "swiss-grid", "midnight-product"],
  content: `# Landing page

## Intent
One page, one action (sign up, buy, book a demo). Every section moves the visitor toward it. Write the message first, then let the words decide the layout. Success: a stranger can say what it is, who it is for and what to do within 5 seconds, and the page could not belong to another product if the logo were swapped.

## Workflow
1. get_selection / get_document. Reuse existing $variables, else list_styles / get_style (prefer this skill's styles) and pick one by product character, not habit.
2. Write the copy outline (hero line, 4-6 section headlines, CTA label) before drawing.
3. find_empty_space for a 1440 wide frame (mobile variant 390, tablet 834 only if asked).
4. Build section by section with batch_design. Repeated UI (nav link, button, feature item, plan card) becomes a component plus ref instances.
5. After each section: get_screenshot + check_layout, fix, continue. End with focus_nodes on the page.

## Frame recipe
- Page: vertical, width 1440, height fit_content, gap 0. Section: vertical, width fill_container, padding [96, 80], inner content frame max 1200 (alignItems center on the section).
- Nav: row, height 72, padding [0, 80], logo wordmark left, 3-5 links center or right, one button. Links only to sections that exist.
- Hero: vertical or two-column row, padding [112, 80, 96], gap 24 text stack. Headline 56-80 / weight 600-700 / lineHeight 1.05-1.15, max 2-3 lines, 8-12 words. Support 18-20 / lineHeight 1.5 / $text-muted, width 520-600. One primary button (height 52) plus at most one text-style secondary.
- Hero visual: a real UI composition built from Pego frames (product screen, data, large type) or an image. Never grey skeleton bars as a product shot.
- Section title 36-44 / 600, body 16-18, eyebrow label 13-14 (sentence case, no wide-tracked uppercase). Gaps: 8 title-support, 48-64 between header and content, 24-32 between items.
- Final CTA: one line, one button, plain footer (only link groups that exist).

## Rhythm
Alternate compositions: split text/visual, full-bleed statement, bento of unequal tiles, numbered list with large numerals, comparison table, quote. Alternate dense and airy, light and one inverted section. Spacing varies: 96 for major breaks, 64 inside related sections. Pick one alignment axis per section; centered text at most 3 lines.

## Rules
- Banned: purple-to-blue or any default gradient, glow, glassmorphism on everything, emoji as icons, sparkle/bolt/robot icons, "Unlock the power of", "seamless", "supercharge", lorem ipsum, three identical icon cards, every section centered, pill shape on everything, accent on decoration, fake logo bar, fake testimonials, invented stats, "Most popular" badge by default, grid-paper backgrounds.
- Do: one accent color reserved for the primary action and one key highlight; one radius scale (for example 8 controls, 16 containers); flagship feature gets a large tile, supporting ones a plain list; photos or real UI over illustration.
- Without real proof, skip the proof section. Without real prices, skip pricing. Say what the product does instead.

## Copy
Same language as the prompt (Indonesian prompt, Indonesian copy). Outcome over feature: "Tagihan terkirim dan lunas tanpa kejar-kejaran" beats "Platform tagihan all-in-one". Buttons name the action ("Coba gratis 14 hari", "Jadwalkan demo"), never "Get Started" or "Learn More". No em dashes.`,
  checklist: [
    "Hero states what it is, for whom and the next step; headline at most 3 lines",
    "Exactly one primary CTA per view; accent color used only on it and one key highlight",
    "All text contrast >= 4.5:1 (3:1 for 24px+); no body text under 14px",
    "Each section has one alignment axis; adjacent sections differ in composition",
    "check_layout reports no clipped or overflowing content on every frame",
    "Radius, spacing and colors come from tokens/variables, no one-off values",
    "Copy is real and specific; no lorem ipsum, buzzwords, fake stats or testimonials",
    "Repeated UI is a component with instances; nav links point to existing sections",
  ],
};
