import type { Skill } from "../types";

export const dashboardSkill: Skill = {
  id: "dashboard",
  title: "Dashboards and data screens",
  description:
    "Analytics, admin panels, tables and KPI screens with honest charts built from Pego shapes.",
  keywords: [
    "dashboard",
    "analytics",
    "admin panel",
    "admin",
    "data table",
    "kpi",
    "chart",
    "report",
    "halaman admin",
    "dasbor",
    "tabel data",
    "laporan",
    "grafik",
    "statistik",
  ],
  styles: ["carbon-dense", "data-dense-dark", "clinical-light", "quiet-ink", "swiss-grid"],
  content: `# Dashboards

Purpose: a person makes a decision here. Write it down ("which job failed and should I retry?") and build the hierarchy from it. If the answer is a list, the list is the page and KPIs are a footnote.

## Workflow
1. get_selection / get_document, reuse variables; otherwise get_style for a dense style and set_variables.
2. find_empty_space for a 1440x1024 page frame (or 1440x900 for fixed viewports).
3. batch_design in passes: shell (sidebar + main), header and filters, primary region, supporting panels. Row, KPI card and nav item are components.
4. get_screenshot, check_layout, fix, then focus_nodes.

## Structure (1440 wide)
- Sidebar 240 (optional), main fills the rest, padding 32, gap 24. Title row: page title 24-28/600 left, actions right, height 40.
- Filter bar only with filters that exist: height 40, gap 8.
- Content in a horizontal frame: primary panel fill_container (about 2/3), side column 360-400 with gap 16-24.
- Panel: fill $surface, 1px $border, radius md, padding 20, header (14/600 title + muted 12 meta) then body, gap 16.

## KPIs
Label 12-13 muted, value 28-40 in tabular/mono face, comparison 12 with the named period ("vs last 7 days"). At most one highlighted KPI. Max 4 KPIs, and not four identical boxes if one matters more: make it larger.

## Charts from Pego shapes (no precision you do not have)
- Vertical bars: horizontal frame, alignItems end, gap 8-12; each bar a rectangle width fill_container and numeric height = value / max * plot height (compute it). Labels in a matching row below so they align by layout. Radius only on the data end (top).
- Horizontal bars: vertical frame of rows: label (fixed width), track frame, fill rectangle with numeric width, value right-aligned.
- Share / progress: track rectangle + fill rectangle. Donut: ellipse with stroke and only 2-3 segments, or prefer bars. No 3D, no gradients on data.
- One hue for one measure; highlight the key bar with the accent and keep the others neutral. Categorical colors only when identity matters, max 5, never a rainbow. Gridlines faint, 2-4 of them, axis labels 11-12 muted. Title states the question ("Failed jobs per hour, last 24h").
- Use representative data and label it as sample. Round honestly (12.4k, not 12,431.77). Never invent trends, percentages or "AI insights".

## Tables
Header row muted 12, rows fixed height 40-48, 1px bottom borders, numbers right-aligned in tabular figures, status as dot + text, one row component. Truncate long text, never wrap numbers. Include an empty state and an error state with cause and next step.

## Type and space
12, 13, 14, 20, 28, 40. Spacing 8, 12, 16, 20, 24. Dense but never below 12px.

## Bans
Rainbow charts, identical KPI cards with invented numbers, glass panels, shadows on every card, pie charts with 8 slices, fake avatars in activity feeds, color-only status, sparklines with no scale.`,
  checklist: [
    "The decision this screen supports is obvious from the largest element",
    "Charts have numeric sizes computed from the data and a title that states the question",
    "Only one highlighted KPI or bar; other marks are neutral",
    "Numbers are right-aligned, tabular, and use consistent rounding and units",
    "Status is shown with text or an icon, not color alone",
    "Tables use one row component with instances; row height is fixed",
    "An empty or error state exists for the main data surface",
    "Sample data is plausible and labeled; no invented people, claims or insights",
  ],
};
