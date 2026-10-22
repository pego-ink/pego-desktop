import type { Skill } from "../../types";

/*
 * Sources:
 * - https://m3.material.io/styles/color/roles (color roles: primary, secondary, tertiary, surface, containers, on-colors)
 * - https://m3.material.io/styles/shape/corner-radius-scale (shape scale)
 * - https://m3.material.io/styles/elevation/overview (levels expressed mainly as tonal surface color)
 * - https://m3.material.io/styles/typography/type-scale-tokens (display, headline, title, body, label)
 * - https://www.nngroup.com/articles/flat-design/ (Material as Flat 2.0)
 * - https://developer.android.com/design/ui/wear/guides/get-started/design-language (M3 Expressive shape variety)
 * Note: the m3.material.io pages render client-side; token values below are the published baseline values.
 */
export const materialDesignSkill: Skill = {
  id: "material-design",
  title: "Material Design 3",
  description:
    "Material 3 / Material You: tonal color roles, a shape scale, a type scale and elevation by surface tone, applied as a system rather than a look.",
  category: "style",
  keywords: [
    "material design",
    "material 3",
    "material you",
    "m3",
    "google material",
    "android design",
    "material ui",
    "gaya material",
    "desain material",
    "desain android",
    "tampilan google",
  ],
  styles: ["clinical-light", "playful-rounded", "nordic-calm"],
  checklist: [
    "Colors are named roles ($primary, $on-primary, $primary-container, $surface, $surface-container, $outline) and every element pairs a container with its on-color",
    "One seed hue generates all accents; no extra unrelated brand colors",
    "Radius comes from the shape scale (4, 8, 12, 16, 28, full) by component role",
    "Type uses the scale roles only: display, headline, title, body, label, with M3 sizes",
    "Elevation is shown by surface tone (surface, surface-container, surface-container-high), not by shadows",
    "Primary action is one filled button; secondary actions are tonal, outlined or text buttons",
    "Touch targets are at least 48 tall and spacing follows a 4/8 grid",
    "Text and icons on every container pass 4.5:1 and check_layout is clean",
  ],
  content: `# Material Design 3

## Essence
Google's design system. Material (2014) used paper and ink metaphor with shadows; Material 3 (2021, "Material You") makes color personal and tonal: one seed color becomes tonal palettes (HCT color space) that map to semantic roles. Material 3 Expressive (2025) adds bolder shape variety and motion. It solves consistency at scale: a documented set of tokens for color, type, shape and state, so apps feel related without being identical. Think system first, decoration never.

## Visual vocabulary
- Color roles (baseline purple seed, light): primary #6750A4 / on-primary #FFFFFF; primary-container #EADDFF / on-primary-container #21005D; secondary-container #E8DEF8; tertiary #7D5260; surface #FEF7FF; surface-container #F3EDF7; surface-container-high #ECE6F0; on-surface #1D1B20; on-surface-variant #49454F; outline #79747E; outline-variant #CAC4D0; error #B3261E. Dark: surface #141218, on-surface #E6E0E9, primary #D0BCFF, primary-container #4F378B.
- Shape scale: none 0, extra-small 4, small 8, medium 12, large 16, extra-large 28, full (pill). Buttons full, cards 12, FAB 16, dialogs 28, text fields 4 on top.
- Type scale (size/line): display L 57/64, M 45/52; headline L 32/40, M 28/36, S 24/32; title L 22/28, M 16/24 (500), S 14/20 (500); body L 16/24, M 14/20, S 12/16; label L 14/20 (500), M 12/16 (500). Roboto is the default; Google Sans, Roboto Flex or Inter work too.
- Elevation: levels 0, 1, 3, 6, 8, 12 dp. In M3 they read mostly as surface tone, with a soft shadow only on floating items.
- State layers: hover 8 percent, focus and press 10-12 percent of the on-color over the container.
- Icons: Material Symbols are not available; use lucide at stroke 2, size 24, color on-surface-variant.

## Translating into Pego
- Define all roles above as variables ($primary, $on-primary, ...). Define $radius-xs 4, $radius-sm 8, $radius-md 12, $radius-lg 16, $radius-xl 28.
- Components: Button/Filled (height 40, padding [0, 24], radius full, fill $primary, label 14 weight 500 $on-primary), Button/Tonal ($secondary-container), Button/Outlined (stroke 1 $outline), Card (radius $radius-md, fill $surface-container, padding 16), Chip (height 32, radius 8, stroke $outline-variant), List item (height 72, padding [8, 16]).
- Elevation without shadow: stack surface, surface-container, surface-container-high; a FAB or dialog also gets a duplicate rectangle behind it offset y 2 in black at opacity 0.12.
- Landing hero: background $surface, display M 56 headline in $on-surface, body L, Filled plus Outlined buttons, right side a large container shape (radius 28, $primary-container) holding a device mock.
- App screen: top app bar (height 64, headline S title), content cards in $surface-container, navigation bar at the bottom (height 80, active item with a $secondary-container pill 64x32), FAB 56x56 radius 16.

## Pitfalls
- Material is not purple. Pick a seed from the product's brand and derive tones; default purple signals a template.
- Do not mix shadows with tonal elevation, and do not use random hex outside the roles.
- Material is a system: filling a landing page with M3 widgets looks like an Android settings screen. Use for product UI and app-like pages.
- Pills everywhere flatten hierarchy; vary shape by role.

## Pair with
dashboard and app-screen build skills, design-system skills (map roles to variables).

Fonts: Roboto, Google Sans, Inter`,
};
