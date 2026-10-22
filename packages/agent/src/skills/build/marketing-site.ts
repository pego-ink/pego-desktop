import type { Skill } from "../types";

export const marketingSiteSkill: Skill = {
  id: "marketing-site",
  title: "Marketing site",
  description:
    "Multi-page product or company site: home, pricing, about, blog index, contact, built on one shared system.",
  keywords: [
    "marketing site",
    "marketing website",
    "company website",
    "company profile",
    "multi page website",
    "pricing page",
    "about page",
    "blog index",
    "contact page",
    "website perusahaan",
    "situs perusahaan",
    "profil perusahaan",
    "halaman harga",
    "website bisnis",
    "tentang kami",
  ],
  styles: ["warm-editorial", "swiss-grid", "studio-minimal", "forest-sage", "newsprint"],
  content: `# Marketing site

## Intent
A small set of pages that share one system and one voice: Home, Pricing, About, Blog index, Contact (only pages the business has content for). Success: pages feel like one brand, navigation never lies, each page has one job and one action, and the system (not copy-pasting) keeps them consistent.

## Workflow
1. get_selection / get_document; reuse variables, else list_styles / get_style (prefer this skill's styles) and set tokens once: colors, type scale, radius, spacing.
2. Define the sitemap and each page's one job and CTA in a line each. Nav lists only pages you build.
3. Build shared components FIRST with create_component: nav bar, footer, button (primary / secondary), section header, CTA band, card variants, form field. Every page uses ref instances.
4. find_empty_space for each page frame, 1440 wide, placed in a row left to right in nav order (padding 120). Name frames "Home", "Pricing", "About", "Blog", "Contact". Add a 390 mobile Home if asked.
5. Per page: build section by section, get_screenshot + check_layout each, then compare pages side by side for shared chrome. focus_nodes at the end.

## Shared system
- Nav: row, height 72, padding [0, 80], logo left, 4-5 links, one CTA button; current page link is weight 600 with a 2px underline in $accent. Footer: only link groups that exist; company name, contact line, one small legal row; 64-96 top padding.
- Section: padding [96, 80] (64 for tight ones), content max 1200. Page header on inner pages: padding [96, 80, 64], title 48-64 / 600-700 / lineHeight 1.1, one support line 18-20 width 560.
- Type: display 56-72, h2 36-44, h3 22-28, body 16-18 / 1.55, small 14. Max two font families. Grid: 12 columns of 1200, gap 24.

## Page recipes
- Home: promise hero, one proof or demo block, 2-3 differently shaped feature sections, closing CTA. Keep it shorter than the sum of the other pages.
- Pricing: 2-4 plans as row of equal-height columns, price 40-48, plan name 18, 5-7 features with check icons, one button each; emphasize a plan only if it truly serves the goal (fill inversion, not a badge). Below: comparison table or 4-6 FAQs specific to this product. Show real prices or "Hubungi kami"; never invent them.
- About: story in prose (width 640) beside a large image or fact list, values as a numbered list not icon cards, team only with real people else skip.
- Blog index: featured post large (image 2/3 + text) then a 3-column grid of post rows: image 16:10, category 13, title 20-22, date 13. Titles must read like real articles.
- Contact: split row, left a short intro plus direct channels (email, WhatsApp, address), right a form with 3-5 fields and one button; show a success state.

## Banned
Pages that look unrelated; nav links to pages that do not exist; copy-pasted rather than instanced nav/footer; hero + three icon cards + testimonials + logo bar on every page; fake logos, reviews, team photos, stats; "Most popular" pill by default; generic FAQs ("Is my data secure?"); purple gradients, glass, glow; emoji icons; 4-column template footer with filler links; lorem ipsum.

## Copy
One voice across pages, in the prompt language (Indonesian prompt, Indonesian copy). Headlines state facts or outcomes; CTAs name the action ("Lihat paket harga", "Kirim pesan"). No em dashes.`,
  checklist: [
    "Nav and footer are shared component instances, identical on every page",
    "Every nav link maps to a page frame that exists",
    "Each page has one job and one primary CTA per view",
    "Tokens consistent across pages: type scale, radius, spacing, accent usage",
    "Adjacent sections differ in composition; no page is a hero + 3 icon cards template",
    "Pricing, team, logos and stats are real or omitted; FAQs specific to the product",
    "Contrast >= 4.5:1; body text >= 16px, nothing under 13px",
    "check_layout clean on every page frame; screenshots compared side by side",
    "Copy in the prompt language, concrete, no buzzwords, lorem ipsum or em dashes",
  ],
};
