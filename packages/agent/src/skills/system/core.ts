import type { Skill } from "../types";

export const coreSkill: Skill = {
  id: "core",
  title: "Core design rules",
  description: "Anti-slop rules that apply to every design made in Pego.",
  core: true,
  keywords: [],
  styles: [],
  content: `# Core design rules

Goal: work that looks designed by a person with a point of view, not generated. Every choice answers "what does this serve?" If the answer is only "it looks techy / safe / default", change it.

## Before building
- Read the document first (get_selection, get_document). Match existing variables, fonts and components. Never restyle what the user did not ask to change.
- No brand yet: pick a style (list_styles, get_style) and set_variables once. Every color, radius, gap and font size then comes from a $variable.
- State the design in one line before you start: what it is, who reads it, which style, which single focal point per screen.

## Typography
- One scale per design, jumps of 1.25x to 1.5x. Few sizes, many contrasts through weight and color. Two families max (heading + body), a mono only for data.
- Body 14px or more on screens (24px or more on slides), never below 11px. Line length 45-75 characters. Left-align paragraphs; center at most 2-3 lines.
- Give text a width (fill_container or a number) so it wraps; never a fixed height. Tight line height for headings (1.1-1.2), 1.4-1.6 for body. Avoid wide-tracked uppercase except tiny labels.

## Color
- Neutrals carry 90% of the screen, tinted slightly toward the brand hue. One accent for the primary action and one highlight. Status colors (red/amber/green) only for status, always with text or icon.
- Contrast: text 4.5:1 (large 3:1). Muted text still passes. Check dark surfaces separately.
- Banned by default: blue-to-purple or purple-to-pink gradients, glow, glassmorphism, neon on dark, rainbow palettes. A gradient or shadow needs a hierarchy reason and appears at most once or twice.

## Space and alignment
- Spacing scale 4, 8, 12, 16, 24, 32, 48, 64, 96. Tight inside a group, loose between groups; the gap between groups is at least 2x the gap inside. Never equal spacing everywhere.
- Align to one left edge per column. Use layout, gap and padding; never nudge with x and y inside a flex frame.
- One radius scale (sm, md, lg) by role. Not everything is a pill; not every card has a shadow. Prefer 1px borders over blur shadows.

## Content
- Real copy in the user's language, specific to the product. No lorem ipsum, no "Get started / Learn more / Seamless / Powerful / Revolutionary", no em dashes, no sparkle icons for AI.
- No invented stats, testimonials, logos or people presented as real. Use labeled placeholders or representative values that are plainly sample data.
- Icons: lucide via search_icons, one stroke weight and size family, only when they carry meaning. Never emoji as icons. Never draw illustration with paths.
- Do not repeat one card (icon, title, two lines) three or four times as the whole page. Vary scale: one big, a few small, or a list.

## Components and tokens
- Repeated UI (button, card, row, nav item, tag) is one component plus instances with overrides. Name nodes by role (Sidebar, KPI Card), never Frame 12.
- Hardcoded hex or pixel radii in a design that has variables is a defect.

## Verify
After each section: get_screenshot, then check_layout. Look for clipped text, uneven gaps, weak hierarchy, low contrast. Fix with update_node in place. Final check_layout on the whole document, then focus_nodes.`,
  checklist: [
    "Every color, radius and gap uses a $variable or a value from the declared scale",
    "One clear focal point per screen; hierarchy visible at squint level in the screenshot",
    "No more than two font families and a single type scale; body text meets the minimum size",
    "Text contrast passes 4.5:1 (3:1 large); check_layout reports no contrast or overflow errors",
    "No placeholder copy: no lorem ipsum, no generic CTAs, no invented stats or people",
    "No default gradient, glow, glassmorphism or emoji icons",
    "Repeated elements are component instances, not copies; nodes have role names",
    "Spacing is grouped (inner gap smaller than outer gap) and edges align per column",
  ],
};
