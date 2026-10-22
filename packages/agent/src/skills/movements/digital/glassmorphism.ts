import type { Skill } from "../../types";

/*
 * Sources:
 * - https://www.nngroup.com/articles/glassmorphism/ (use sparingly, sample colors behind, heavier blur on busy backgrounds, respect reduce transparency)
 * - https://axesslab.com/?p=5111 (Glassmorphism meets accessibility)
 * - https://en.wikipedia.org/wiki/Neumorphism (context of 2020 soft-depth trends)
 * - Apple Big Sur / iOS materials, Microsoft Fluent Acrylic (system translucency precedents, as cited by NN/g)
 */
export const glassmorphismSkill: Skill = {
  id: "glassmorphism",
  title: "Glassmorphism",
  description:
    "Translucent frosted layers over color. Pego has no blur, so this skill gives an honest opacity approximation or advises a solid card.",
  category: "style",
  keywords: [
    "glassmorphism",
    "glassmorphic",
    "glass ui",
    "frosted glass",
    "liquid glass",
    "translucent",
    "acrylic",
    "gaya kaca",
    "efek kaca",
    "kaca buram",
    "transparan",
  ],
  styles: ["midnight-product", "sunlit-pastel"],
  checklist: [
    "Glass panels sit over a simple, controlled backdrop (2-3 flat color shapes), never a busy photo",
    "Panel text is sampled against the real composite color and passes 4.5:1 (3:1 for 24px+)",
    "Panel fill opacity is 0.55-0.85 for text panels; below 0.5 only for decoration with no text",
    "Each panel has a 1px stroke in white at about 0.5 opacity or a darker edge so it reads as a layer",
    "At most one level of glass (panels over backdrop), never glass inside glass",
    "Backdrop shapes are tinted flat circles or rectangles with a clear color relationship, not a purple-blue gradient look",
    "A solid fallback variant exists for the same panel (opacity 1) for contrast or reduce-transparency needs",
    "check_layout is clean and the screenshot shows layering without muddy text",
  ],
  content: `# Glassmorphism

## Essence
Translucent, frosted panels floating above color, popularized by macOS Big Sur and Windows Acrylic and then by a 2020 Dribbble wave; Apple's later Liquid Glass revived it at system level. The idea: translucency shows layer order and keeps context (a sheet over a map). It works for overlays, menus and a card on a rich backdrop. It fails when text sits on a busy, uncontrolled background. NN/g: use sparingly, sample the colors behind, use stronger blur on busy backdrops, honor reduce-transparency.

## The Pego reality
No blur, no backdrop filter, no gradients. Without blur, translucency alone makes backdrop shapes show sharply through text, so it hurts legibility more than real glass would. Honest options:
1. Preferred: frosted-look card = near-opaque tinted fill (over light: white at 0.75; over dark: #1E2233 at 0.78, since a thin white tint is too weak for text) with a 1px light stroke.
2. Keep the backdrop simple so sharp edges behind the panel do not cross text: place backdrop shapes where the panel edges, not text, overlap them.
3. If the user needs true blur, say Pego approximates it and offer the solid card.

## Visual vocabulary
- Backdrop: 2-3 large flat shapes (ellipses, rounded rectangles) in one hue family plus one contrast hue, on a flat base. Dark: base #0E1020, shapes #3B5BDB, #E8590C, #12B886 at 0.9. Light: base #F3F0FF, shapes #FFD8A8, #A5D8FF.
- Panel: radius 20-28, fill white 0.7 (light) or #1E2233 0.75 (dark), stroke 1 #FFFFFF at 0.5 (or 0.18 on dark), padding 24-32.
- Type: crisp, medium weight, large: Inter, Manrope or Plus Jakarta Sans. Text #0B1020 on light panels (about 15:1), #F5F7FF on dark.
- Icons lucide stroke 2 in the text color.

## Translating into Pego
- Variables: $base, $blob-a, $blob-b, $glass #FFFFFF at 0.7 (set via a 8-digit hex #FFFFFFB3), $glass-edge #FFFFFF80, $ink #0B1020, $radius-panel 24.
- Hero: page frame layout none for backdrop shapes (ellipses 480-720 wide, positioned partly off the frame, clip true) behind a content frame; headline 64 left on $base directly (not inside glass), one glass card on the right with a product stat or sign-up form, 420 wide, padding 32.
- App screen: backdrop color shapes at the top, a glass sheet (radius 28 top) holding a list of rows; each row plain, separated by 1px strokes at 0.1 opacity; no nested glass.
- Component: Glass Card with props overridden per use; the solid variant is a second component with fill opacity 1.

## Pitfalls
- Light text on a pale translucent panel is the classic failure. Do the math on the composite color.
- Do not glass the whole page: navigation, cards, buttons and modals all frosted is slop.
- No blue-purple gradient backdrops by default (core rule); tie backdrop hues to the brand.
- Skip it for data tables, long text and forms, and for photographic backdrops.

## Pair with
landing-page hero or onboarding screens.

Fonts: Inter, Manrope, Plus Jakarta Sans`,
};
