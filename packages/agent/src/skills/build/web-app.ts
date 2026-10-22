import type { Skill } from "../types";

export const webAppSkill: Skill = {
  id: "web-app",
  title: "Web app",
  description:
    "Functional product UI: app shell, one dominant region, real states, deliberate density, tables and forms.",
  keywords: [
    "web app",
    "webapp",
    "admin panel",
    "admin tool",
    "crm",
    "saas app",
    "app screen",
    "settings page",
    "inbox",
    "aplikasi web",
    "halaman admin",
    "panel admin",
    "tampilan aplikasi",
    "halaman pengaturan",
  ],
  styles: ["carbon-dense", "clinical-light", "quiet-ink", "swiss-grid", "data-dense-dark"],
  content: `# Web app

## Intent
Functional product UI, not a marketing page. Start from the one question the screen answers and the one action it supports (for example "which job failed, retry it"). Success: a user finds the thing, acts, sees feedback, and never guesses what a control does.

## Workflow
1. get_selection / get_document; reuse existing components and $variables first, else list_styles / get_style (prefer this skill's styles).
2. Name the screen job, dominant region and primary action in one line before drawing.
3. find_empty_space for a 1440 frame (tablet 834 if asked). Build the shell first, then the dominant region, then supporting panels.
4. Rows, nav items, inputs, buttons, tags become components; instances use set_instance_overrides. Selected / hover / disabled live in the component.
5. get_screenshot + check_layout after each region; then render empty, loading and error variants of data surfaces. focus_nodes at the end.

## Shell recipe
- Page: horizontal, 1440 x fit_content (about 900). Sidebar: vertical, width 240-280, padding [16, 12], gap 4, 1px $border on the inner edge; nav item row height 36-40, icon 18 + label 14, selected = $surface-2 fill, not accent fill.
- Main: vertical fill_container. Header row height 64, padding [0, 32], page title 20-24 / 600, one primary button right, rest in overflow. Content padding 32, gap 24.
- A single-purpose tool may use only a top bar; choose the shell from the job. Prefer two structural zones over three.
- Detail views: right panel 360-420 or a dialog (width 480-560, padding 24, radius 12), not a new page layout.

## Dominant region
Give the table, editor, chart or form most of the space and the strongest contrast; supporting panels stay small and quiet. Four metrics means one matters most: make it larger. A chart title states the question it answers ("Failed jobs per hour, 24h"); if a sentence answers better, write the sentence.

## Tables, forms, density
- Table: header 12-13 / 500 / $text-muted, row height 44 (compact 32-36), 1px $border bottom OR zebra, not both. Deciding column first, numbers right-aligned, status as text plus small dot, shared column widths via one row component. Row menu only with real actions.
- Forms: labels above, 8 gap, field height 40, padding [10, 12], radius 8, 1px $border, one column; one primary button end-aligned; destructive uses $danger and sits apart.
- Choose one density per screen: compact (13px, rows 32-36), medium (14px, 44), airy (16px). Body never below 13px in dense tools, 14px elsewhere. Spacing scale 4, 8, 12, 16, 24, 32.

## States (required)
Empty says why and offers the one action that fills it ("Belum ada faktur. Buat faktur pertama"); loading names what loads; error says what failed and the next step; also success feedback and permission-limited. Never a bare "No data".

## Banned
Default shell of sidebar + 4 identical stat cards + chart + table chosen from habit; invented numbers, "+12%" deltas without a real period, fake activity feeds with invented people, John Doe rows; icon-only controls for essential actions; every container as a rounded shadowed card; accent on more than the primary action and active state; glass blur; gradients; emoji icons.

## Copy
Labels are verbs and real nouns in the prompt language. Navigation lists only destinations the product has (5-8). Sentence case, no em dashes.`,
  checklist: [
    "Screen has one dominant region sized and contrasted above all others",
    "One primary action per view; destructive actions visually distinct",
    "Empty, loading and error states exist for each data surface",
    "One density mode per screen; body text >= 13px (14px outside dense tools)",
    "Contrast >= 4.5:1 for text, 3:1 for borders of inputs and chart marks",
    "Rows, inputs and nav items are components; column widths consistent across rows",
    "check_layout clean: no clipped table cells, buttons or labels",
    "No invented metrics, deltas or people; placeholders are visibly labeled",
    "Radius and spacing from the token scale; cards used only where they group interactive content",
  ],
};
