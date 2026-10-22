import type { Guide } from "./types";

export const dashboardGuide: Guide = {
  id: "dashboard",
  title: "Dashboards and data screens",
  description:
    "Building data-first screens: the question, dominant chart or table, KPI rows, charts from flex layout, honest data.",
  content: `# Dashboards

## Start from the question
Write the decision the user makes here ("which job failed and should I retry it?") and build the hierarchy around it. If the answer is a list of failing jobs, that list is the page and any stat row is a footnote.

## Layout
- Page 1440 wide: optional nav column + main column. Main is vertical: title row, filters (only the ones that exist), then a 12-column feel built from nested horizontal frames with fill_container children and gap 16-24.
- One dominant region about two thirds of the width; a narrow column for supporting panels. Panels: frame, fill $surface, 1px $border, cornerRadius $radius-md, padding 16-20.
- Use the style's dense spacing scale for data screens (carbon-dense is made for this).

## KPIs
- A KPI is label ($text-muted 12-13px), value (28-40px, mono if the style has one), unit/comparison (12px). Show a comparison only when the compared period is named ("vs last 7 days").
- One highlighted KPI at most. Do not render four identical cards of invented numbers.

## Charts from layout
Pego has no chart node, and the layout engine cannot place single points. Build what flex can express and keep it exact:
- Bar chart: a horizontal frame with alignItems end and a gap; each bar is a rectangle with a numeric height proportional to its value (compute from the data) and width fill_container; labels in a second horizontal frame of the same structure underneath so they align by layout.
- Horizontal bars: vertical frame of rows (label, bar track frame with a filled rectangle of numeric width, value).
- Progress and share: a track rectangle plus a fill rectangle with numeric width.
- Donut and line charts: use path nodes with computed geometry only when the data is real and the shape matters; otherwise choose bars. Never overlay absolutely positioned labels.
- Every chart has a title that is the question it answers ("Failed jobs per hour, last 24h") and an axis the reader can use. Segments need 3:1 contrast against neighbors.

## Tables
Header row in $text-muted, rows with fixed height 36-44, numbers right-aligned in the mono face, status as text plus a small colored dot (not color alone). One row component, instances with set_instance_overrides.

## States and honesty
- Include an empty state and an error state for each data surface where it matters, with cause and next action.
- Use real or plausible, clearly representative values; do not invent activity feeds with fake people.`,
};
