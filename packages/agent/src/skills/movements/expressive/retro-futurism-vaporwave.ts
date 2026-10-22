import type { Skill } from "../../types";

/*
 * Sources:
 * - https://www.smithsonianmag.com/history/googie-architecture-of-the-space-age-122837470/ (Googie, Alan Hess, 1945 to early 1970s; could not be fetched, search summary used)
 * - https://courses.bowdoin.edu/world-science-fiction/wsf/the-vault-of-the-atomic-space-age/ (Atomic Age and Space Age culture)
 * - https://www.chairish.com/blog/sc-googie-style-furniture-space-age-design-elements-ideas/ (Googie design elements)
 * - https://en.wikipedia.org/wiki/Vaporwave (Floral Shoppe 2011, Windows 95, Memphis shapes, statues, fullwidth text, critique of consumer capitalism)
 * - https://dribbble.com/stories/2022/06/02/y2k-design-trends (vaporwave drawing from Memphis, anime, old operating systems)
 * - https://blog.adobe.com/en/publish/2021/05/25/explore-the-lighthearted-retro-futurism-of-vintage-vaporwave-design
 */
export const retroFuturismVaporwaveSkill: Skill = {
  id: "retro-futurism-vaporwave",
  category: "style",
  title: "Retro-futurism and vaporwave",
  description:
    "Yesterday's tomorrow: Space Age and Googie optimism, atompunk posters and 80s-90s synth and vaporwave irony. Controlled palette, geometric order, no neon-on-black default.",
  keywords: [
    "retro futurism",
    "retrofuturism",
    "space age",
    "googie",
    "atompunk",
    "raygun gothic",
    "vaporwave",
    "synthwave",
    "outrun",
    "80s retro",
    "retro 80an",
    "gaya vaporwave",
    "gaya retro futuristik",
    "retro futuristik",
    "zaman atom",
    "estetika vaporwave",
  ],
  styles: ["midnight-product", "bold-block", "sunlit-pastel"],
  checklist: [
    "One lane is chosen (Space Age optimist, atompunk poster, or vaporwave nostalgia) and the page does not blend all three",
    "Palette is limited to 4 hues plus ink and paper, in variables, and the page is not simply neon on black",
    "A deep or warm light ground is used with one glow color at most; glow is reserved for one focal object",
    "Display type is geometric or wide and set large; body type is a clean sans at 16px or more on a calm surface",
    "Motifs are geometric and built from Pego shapes (sun, orbit rings, grid horizon, starburst, arch, statue-free abstract forms), never hand-drawn",
    "Text contrast passes 4.5:1, including text over any sun or grid graphic",
    "Copy has a concrete subject and tone (wit, optimism, melancholy), not generic futuristic buzzwords",
    "check_layout is clean and at most one focal graphic competes with the headline",
  ],
  content: `# Retro-futurism and vaporwave

## Essence
Three related looks that imagine the future from the past. Space Age and Googie (about 1945 to the early 1970s, from Southern California roadside architecture; the term goes back to Douglas Haskell, historian Alan Hess dates its heyday after WWII): boomerangs, starbursts, atoms, swooping roofs and hopeful rocket optimism, with an atompunk undertone of Cold War anxiety. 80s synth culture (neon grids, chrome, sunsets) carried the glow of early computing. Vaporwave (2010-2012 on the web; Macintosh Plus, Floral Shoppe, 2011) recycled 80s-90s corporate culture, Windows 95, Japanese text, fullwidth letters and classical busts as ironic, melancholic commentary on consumer capitalism. The shared idea: a future that never arrived, shown with affection or irony. Handle with care: the default AI output (purple-pink neon on black, grid horizon, chrome text) has no point of view.

## Visual vocabulary
- Composition: strong central object (sun, planet, boomerang, arch), a horizon line, layered bands, big empty sky. Space Age is bright and symmetric; vaporwave is quieter with blocky windows and lots of air.
Fonts: Righteous, Monoton, Orbitron, Michroma, Syncopate, Jost, Space Grotesk
- Typography: Display Righteous or Syncopate 700 at 64-140 (wide, rounded, optimistic), Monoton only for a few words at 56-90, Orbitron for numerals and tags. Body Jost 400 or Space Grotesk 400 at 16-18. Vaporwave labels use fullwidth caps with spaced letters, small sizes 12-14 only for decoration.
- Color (variables): Space Age: spPaper #F7EBD4 (50 percent), spTeal #1E9C95 (15 percent), spOrange #F2682A (10 percent), spBlue #1D3F8F, spInk #1B1B2B, spYellow #F4C531 (accent). Vaporwave: vwSky #FFB3D9, vwLilac #B7A4FF, vwAqua #78E6D0 (pastels carry the look, 60 percent combined), vwDeep #1D1445 (anchor, 25 percent), vwSun #FF8A5B (accent). Reserve neon glow for one object.
- Shapes: starburst (rotated rectangles around a center), atom orbits (ellipse rings with 3px strokes at three rotations), boomerang (path), half sun with horizontal slit bands (rectangles over an ellipse), perspective grid as 10-14 lines, windows as bordered frames with title bars, arches, isometric tiles, checkerboard. Strokes 2-3px.
- Texture substitute: halftone dots for print feel (Space Age), scan lines as thin low-alpha rectangles for VHS (vaporwave only, 5-8 lines, not across text).

## Pego recipes
- Landing hero Space Age (1440 x 800): fill $spPaper; a $spOrange sun of 420 ellipse cut by two paper-colored bars; atom rings in $spBlue around it; headline Righteous 96 in $spInk left, supporting text 20 Jost, one $spTeal pill button; a starburst at 80 px in $spYellow as a single accent.
- Poster / social post (1080 x 1350): sky in $vwSky down to $vwLilac via 4 stacked bands, half sun with slits in $vwSun, horizon grid in $vwDeep strokes, title in fullwidth caps on a window frame (title bar, 2px border) so text sits on a solid surface, small caption in Jost.
- Event page: header as retro window frames, the program as a tidy ticket list on paper, ticket button a rounded rectangle with a boomerang icon. Components: window-frame, ticket-row, orbit-badge.

## Pitfalls
- Neon on black with purple-pink gradients, chrome text and a sun: the stock AI vaporwave. Use a paper ground or a deep pastel scheme and one focal glow.
- Glow on every element, glitch on everything, scan lines over text. Keep decorative effects off reading content.
- Pastiche of statue-plus-palm-tree clichés. Ask what the project's story is; the retro element should serve it.
- Wide display type for body copy. Syncopate and Monoton are display only.
- Accessibility: pastel text on pastel ground fails contrast; text uses vwDeep or spInk, and animation must be avoidable.

## Pair with
midnight-product or sunlit-pastel tokens and the landing-page and social-media skills. For rounder, glassy tech see y2k-frutiger-aero separately; do not stack both in one design.`,
};
