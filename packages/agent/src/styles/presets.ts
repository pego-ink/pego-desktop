import { tokens, type StylePreset } from "./types";

const roomy = [4, 8, 16, 32, 64] as const;
const dense = [4, 6, 12, 20, 32] as const;

export const stylePresets: StylePreset[] = [
  {
    name: "quiet-ink",
    title: "Quiet Ink",
    mood: "Calm, exact, near-monochrome. One cobalt accent, hairline borders, almost no shadow.",
    bestFor: "Productivity apps, docs, settings-heavy tools, B2B landing pages",
    fonts: { heading: "Geist", body: "Geist", mono: "Geist Mono" },
    typeScale: { caption: 12, body: 15, lead: 18, h3: 20, h2: 28, h1: 40, display: 64 },
    variables: tokens(
      {
        bg: "#FAFAF9",
        surface: "#FFFFFF",
        surface2: "#F2F2F0",
        border: "#E2E2DE",
        text: "#16171A",
        textMuted: "#5B5E66",
        accent: "#2B4ACB",
        onAccent: "#FFFFFF",
        danger: "#B42318",
      },
      { radius: [4, 8, 12], space: [...roomy] },
    ),
    stroke: "1px $border on cards and inputs; no stroke on the page background",
    elevation: "Flat. At most one soft shadow on floating layers (menus, dialogs).",
    dos: [
      "Let whitespace and 1px borders separate regions instead of boxes inside boxes.",
      "Use $accent only for the single primary action and for selected state.",
      "Weight 500-600 for headings, 400 for body; size does the hierarchy.",
    ],
    donts: [
      "No gradients, glows or colored card backgrounds.",
      "Do not tint every icon with $accent; keep icons $text-muted.",
    ],
  },
  {
    name: "warm-editorial",
    title: "Warm Editorial",
    mood: "Magazine-like and human. Cream paper, ink text, one terracotta accent, serif headlines.",
    bestFor: "Content sites, newsletters, portfolios, craft and food brands, essays",
    fonts: { heading: "Newsreader", body: "Hanken Grotesk", mono: "IBM Plex Mono" },
    typeScale: { caption: 13, body: 17, lead: 21, h3: 24, h2: 36, h1: 56, display: 88 },
    variables: tokens(
      {
        bg: "#FAF4E8",
        surface: "#FFFBF3",
        surface2: "#F1E8D6",
        border: "#DDD0B8",
        text: "#2A2118",
        textMuted: "#6B5D4C",
        accent: "#B0431F",
        onAccent: "#FFFFFF",
        danger: "#A32121",
      },
      { radius: [2, 4, 8], space: [...roomy] },
    ),
    stroke: "1px $border rules between sections; images and cards stay unframed",
    elevation: "None. Depth comes from paper tones ($bg vs $surface-2).",
    dos: [
      "Headlines in the serif at large sizes with tight line height; body in the sans.",
      "Asymmetric layouts: a wide text column next to a narrow note or image.",
      "Use thin rules and generous top padding to start sections.",
    ],
    donts: [
      "No pill buttons or fully rounded cards; keep corners nearly square.",
      "Do not use pure white or pure black.",
    ],
  },
  {
    name: "midnight-product",
    title: "Midnight Product",
    mood: "Focused dark UI for software people live in. Deep neutral surfaces, one teal accent.",
    bestFor: "Developer and AI tools, analytics apps, SaaS dashboards, product marketing for them",
    fonts: { heading: "Manrope", body: "Inter", mono: "Geist Mono" },
    typeScale: { caption: 12, body: 14, lead: 18, h3: 20, h2: 28, h1: 44, display: 72 },
    variables: tokens(
      {
        bg: "#0B0D12",
        surface: "#13161D",
        surface2: "#1B1F28",
        border: "#2A2F3A",
        text: "#ECEEF2",
        textMuted: "#9AA1AF",
        accent: "#2DD4BF",
        onAccent: "#06201C",
        danger: "#F87171",
      },
      { radius: [6, 10, 16], space: [...roomy] },
    ),
    stroke: "1px $border; selected rows and inputs get a 1px $accent stroke",
    elevation: "Layer by lightness: $bg < $surface < $surface-2. No drop shadows.",
    dos: [
      "Use $on-accent (dark) text on $accent fills, never white.",
      "Show data in mono (Geist Mono) with tabular feel; labels in $text-muted.",
      "Keep one glowing or filled element per screen at most.",
    ],
    donts: [
      "No purple-blue gradients, glow on every card or glassmorphism.",
      "Do not put $text-muted below 12px.",
    ],
  },
  {
    name: "terminal-green",
    title: "Terminal Green",
    mood: "Hacker-clean and technical. Near-black, monospaced headings, phosphor green used sparingly.",
    bestFor: "CLIs, infra and security products, API docs, hackathon and open-source sites",
    fonts: { heading: "IBM Plex Mono", body: "IBM Plex Sans", mono: "IBM Plex Mono" },
    typeScale: { caption: 12, body: 15, lead: 18, h3: 20, h2: 28, h1: 40, display: 64 },
    variables: tokens(
      {
        bg: "#0A0C0A",
        surface: "#101410",
        surface2: "#171D17",
        border: "#263026",
        text: "#D7E6D7",
        textMuted: "#8AA08A",
        accent: "#4ADE80",
        onAccent: "#04150A",
        danger: "#FF6B6B",
      },
      { radius: [0, 2, 4], space: [...dense] },
    ),
    stroke: "1px $border everywhere; panels read as outlined terminals",
    elevation: "None. Separation by borders only.",
    dos: [
      "Show real commands, flags and output in text nodes; they are the illustration.",
      "Keep radii at 0-4 so panels look like windows.",
      "Reserve $accent for prompts, the primary button and success state.",
    ],
    donts: [
      "No decorative grids, scanlines or fake matrix rain.",
      "Do not set body copy in the mono face; long text stays in IBM Plex Sans.",
    ],
  },
  {
    name: "soft-bento",
    title: "Soft Bento",
    mood: "Friendly and tactile. Rounded white tiles of different sizes on a warm sand page.",
    bestFor: "Consumer apps, feature showcases, personal finance, wellness, onboarding",
    fonts: { heading: "Outfit", body: "DM Sans", mono: "DM Sans" },
    typeScale: { caption: 13, body: 16, lead: 20, h3: 22, h2: 32, h1: 48, display: 72 },
    variables: tokens(
      {
        bg: "#EFEDE6",
        surface: "#FFFFFF",
        surface2: "#E6E3D9",
        border: "#D8D4C7",
        text: "#1D1C1A",
        textMuted: "#625F57",
        accent: "#C23B22",
        onAccent: "#FFFFFF",
        danger: "#B42318",
      },
      { radius: [12, 20, 28], space: [...roomy] },
    ),
    stroke: "None on tiles; 1px $border only on inputs",
    elevation: "Tiles are separated by 12-16px gaps on $bg, not by shadows.",
    dos: [
      "Vary tile sizes: one large hero tile, several half and quarter tiles, to show priority.",
      "Put one number, one icon or one short sentence per tile.",
      "Use $surface-2 for a secondary tile and $accent for at most one tile.",
    ],
    donts: [
      "Do not make all tiles the same size (that is a plain grid).",
      "No nested rounded cards inside tiles; use padding and type instead.",
    ],
  },
  {
    name: "bold-block",
    title: "Bold Block",
    mood: "Loud and playful. Flat saturated yellow, thick black strokes, hard offset shapes.",
    bestFor: "Creator tools, youth and event brands, launch pages that should be remembered",
    fonts: { heading: "Archivo Black", body: "Archivo", mono: "Space Mono" },
    typeScale: { caption: 13, body: 16, lead: 20, h3: 24, h2: 40, h1: 64, display: 112 },
    variables: tokens(
      {
        bg: "#FFE14D",
        surface: "#FFFFFF",
        surface2: "#FFF3B0",
        border: "#000000",
        text: "#000000",
        textMuted: "#3A3A3A",
        accent: "#D42612",
        onAccent: "#FFFFFF",
        danger: "#D42612",
      },
      { radius: [0, 4, 8], space: [...roomy] },
    ),
    stroke: "2px $border on every card, button and input",
    elevation: "Hard offset: a solid black rectangle 4-6px right and down behind a card, no blur.",
    dos: [
      "Huge, tight headlines (Archivo Black) that fill the width.",
      "Keep text black; color comes from $bg, $surface and one $accent block.",
      "Use the offset shadow only on interactive cards and buttons.",
    ],
    donts: [
      "No soft shadows, gradients or thin hairlines; everything is thick or absent.",
      "Do not use more than two fills per section.",
    ],
  },
  {
    name: "forest-sage",
    title: "Forest Sage",
    mood: "Grounded and trustworthy. Pale sage backgrounds, deep green accent, soft serif headings.",
    bestFor: "Wellness, sustainability, finance for individuals, healthcare, education",
    fonts: { heading: "Fraunces", body: "Karla", mono: "Space Mono" },
    typeScale: { caption: 13, body: 16, lead: 20, h3: 24, h2: 34, h1: 52, display: 80 },
    variables: tokens(
      {
        bg: "#F0F3EC",
        surface: "#FAFBF7",
        surface2: "#E1E8DA",
        border: "#CBD6C2",
        text: "#1B2B22",
        textMuted: "#566659",
        accent: "#1F5A3F",
        onAccent: "#FFFFFF",
        danger: "#A93226",
      },
      { radius: [8, 14, 22], space: [...roomy] },
    ),
    stroke: "1px $border on inputs; cards use $surface on $bg instead of a stroke",
    elevation: "Tonal: $surface-2 for the active or secondary area. No shadows.",
    dos: [
      "Pair the Fraunces headline with calm, short body copy in Karla.",
      "Use $accent for buttons and key figures; it already has strong contrast on every surface.",
      "Prefer real photography or plain color fields over illustrations.",
    ],
    donts: [
      "No neon or saturated secondary colors; if you need a second hue, use $danger only for errors.",
      "Do not center long paragraphs.",
    ],
  },
  {
    name: "carbon-dense",
    title: "Carbon Dense",
    mood: "Compact, data-first, instrument-panel dark gray with an orange signal color.",
    bestFor: "Dashboards, admin panels, trading, monitoring, tables and logs",
    fonts: { heading: "Inter", body: "Inter", mono: "Geist Mono" },
    typeScale: { caption: 11, body: 13, lead: 15, h3: 16, h2: 20, h1: 28, display: 40 },
    variables: tokens(
      {
        bg: "#121316",
        surface: "#1A1C20",
        surface2: "#23262B",
        border: "#33373E",
        text: "#E8E9EB",
        textMuted: "#9A9FA8",
        accent: "#FF8A3D",
        onAccent: "#1A0D02",
        danger: "#FF6B5E",
      },
      { radius: [3, 6, 10], space: [...dense] },
    ),
    stroke: "1px $border between panels; rows separated by 1px lines, not gaps",
    elevation: "None. Panels are $surface on $bg; headers and hovered rows use $surface-2.",
    dos: [
      "Right-align numbers, show them in the mono face, and keep units in $text-muted.",
      "One dominant region (the chart or table that answers the screen's question), small supporting panels.",
      "Use $accent for the single metric or alert that needs attention.",
    ],
    donts: [
      "No decorative stat cards with invented numbers or fake trend deltas.",
      "Do not use more than 13px for table body text.",
    ],
  },
];

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();

export const findStyle = (name: string): StylePreset | undefined =>
  stylePresets.find((preset) => preset.name === normalize(name));
