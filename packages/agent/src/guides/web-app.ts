import type { Guide } from "./types";

export const webAppGuide: Guide = {
  id: "web-app",
  title: "Web apps and admin tools",
  description:
    "Structure for functional product UI: shell, dominant region, states, density, tables and forms.",
  content: `# Web app screens

Design functional product UI, not a marketing page. Start from the one question the screen answers and the one action it supports.

## Shell
- Page frame 1440 wide, layout horizontal: a nav column (width 220-260, fill $surface or $bg, 1px $border on the inner edge) and a main column (fill_container).
- Main column is vertical: a header row (title, one primary button, secondary actions in an overflow), then the content.
- Not every app needs a sidebar. A single-purpose tool can use a top bar only. Choose the shell from the job, not from habit.

## Dominant region
- Every screen has one region that carries the weight: the table, the editor, the chart, the form. Give it the most space and the strongest contrast; keep supporting panels small and quiet.
- Avoid equal-weight card rows. If four metrics matter, one of them matters most; make it larger.

## States
- Design the real state set for data surfaces: loading, empty, error, success. An empty state says why it is empty and offers the one action that fills it.
- Selected, hover and disabled states of repeated items belong in the component (create_component), not in instances.

## Tables and lists
- Pick columns from the decision the user makes; put the deciding column first. Right-align numbers.
- Rows: fixed-height horizontal frames, cells with fill_container or fixed widths shared by every row. Build one row as a component and instance it with set_instance_overrides for the text.
- Header row uses $text-muted, 12-13px, weight 500; rows have a 1px $border bottom (stroke on a frame) or alternating $surface-2, never both.

## Forms
- Labels above inputs, 8px gap; fields 40px tall; one column unless fields are tightly related.
- Input: frame with stroke 1px $border, padding [10, 12], cornerRadius $radius-md, text in $text, placeholder in $text-muted.
- Primary button once per form, aligned to the end. Destructive actions look different ($danger) and sit apart.

## Density
- Choose one: compact (body 13px, row 32-36), medium (14-15px, row 44), airy (16px+). Do not mix inside one screen.
- Body text 13px minimum in dense tools, 14px elsewhere.

## Content
- Use realistic labels and plausible example rows. Do not invent trend arrows or percentages for numbers you made up; show the number or leave the slot empty.
- Navigation items must be things the product would really have; keep the list short.`,
};
