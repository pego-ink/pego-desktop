import type { Skill } from "../types";

export const designSystemSkill: Skill = {
  id: "design-system",
  title: "Design systems",
  description:
    "Tokens as variables, reusable components with instances and overrides, documented on the canvas.",
  keywords: [
    "design system",
    "component library",
    "ui kit",
    "tokens",
    "style guide",
    "components",
    "sistem desain",
    "pustaka komponen",
    "komponen",
    "panduan gaya",
  ],
  styles: ["swiss-grid", "quiet-ink", "studio-minimal", "carbon-dense", "clinical-light"],
  content: `# Design systems

Purpose: a small set of decisions that a team can reuse. Success: change one variable or component and every screen follows; nothing in the system is hardcoded.

## Workflow
1. get_document first. Extend what exists; never create a second set of tokens.
2. Pick a style (list_styles, get_style) and set_variables for the foundation.
3. Build atoms, then molecules, then documentation frames, one batch_design per group, with get_screenshot and check_layout after each.
4. Prove the system: build one small sample screen using only instances.

## Tokens (variables)
- Color roles, not colors: bg, surface, surface-2, border, text, text-muted, accent, on-accent, danger, success, warning. Names describe role (surface), never value (light-gray).
- Radius: radius-sm 4, radius-md 8, radius-lg 16. Spacing: 4, 8, 12, 16, 24, 32, 48, 64. Type sizes as numbers: 12, 14, 16, 20, 28, 40, 56.
- Dark theme: same names, different values (lighter surface means higher elevation, softer text). Do not invent new roles for dark.

## Components
- Build bottom-up with create_component: Button (primary, secondary, ghost as separate components or distinct variants by name), Input, Tag, Avatar, Icon Button, then Card, List Row, Nav Item, Modal.
- Structure: a frame with layout and padding, children addressed by stable ids (label, icon) so descendants overrides work. Content hugs (fit_content) unless it must stretch (fill_container).
- Reference tokens inside components ($accent, $radius-md); never raw hex.
- Use create_instance, then set_instance_overrides for text, icon and visibility. detach_instance only when a copy must diverge for real.
- States as separate labeled instances (default, hover, disabled) in the documentation, not hidden.

## Documentation frames
One frame per group on the canvas, titled with a heading and a one-line rule: Colors (swatch rectangle 96x96 + token name + hex), Type (each size with name, size/weight, sample line), Spacing (bars at true widths), Radius, Components (every variant with a label under it). Grid with gap 48 between groups, 24 inside. Document styling uses the system's own tokens.

## Sizes
Button height 40 (sm 32, lg 48), padding 16, text 14/500. Input height 40, 1px border. Row height 48. Icon 16 or 20. Touch targets 44 on mobile.

## Bans
Near-duplicate components, one-off hex values, 14 gray shades, a token for everything, undocumented variants, decorative sample content, inconsistent radii.`,
  checklist: [
    "Every color, radius, gap and font size in components references a variable",
    "Variables are named by role, and the dark theme reuses the same names",
    "Each repeated element exists once as a component and is used through instances",
    "Component children have stable ids so descendants overrides work",
    "Every component variant is shown and labeled in the documentation frames",
    "A sample screen made only of instances renders correctly",
    "No component duplicates another with a small difference",
    "check_layout is clean and docs frames are aligned on one grid",
  ],
};
