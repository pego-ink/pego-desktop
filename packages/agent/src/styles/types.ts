import type { Variables } from "@pego/doc";

export type StylePreset = {
  /** Kebab-case id used by get_style. */
  name: string;
  title: string;
  mood: string;
  /** Product kinds it fits. */
  bestFor: string;
  /** Google Fonts family names. */
  fonts: { heading: string; body: string; mono: string };
  /** Pixel scale for type; use these sizes instead of inventing new ones. */
  typeScale: {
    caption: number;
    body: number;
    lead: number;
    h3: number;
    h2: number;
    h1: number;
    display: number;
  };
  /** Ready for set_variables: color tokens and number tokens (radius, spacing). */
  variables: Variables;
  stroke: string;
  elevation: string;
  dos: string[];
  donts: string[];
};

type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
};

type Scale = { radius: [number, number, number]; space: [number, number, number, number, number] };

const color = (value: string) => ({ type: "color" as const, value });
const num = (value: number) => ({ type: "number" as const, value });

/** The same token names in every style, so components built on them restyle by swapping values. */
export const tokens = (palette: Palette, scale: Scale): Variables => ({
  bg: color(palette.bg),
  surface: color(palette.surface),
  "surface-2": color(palette.surface2),
  border: color(palette.border),
  text: color(palette.text),
  "text-muted": color(palette.textMuted),
  accent: color(palette.accent),
  "on-accent": color(palette.onAccent),
  danger: color(palette.danger),
  "radius-sm": num(scale.radius[0]),
  "radius-md": num(scale.radius[1]),
  "radius-lg": num(scale.radius[2]),
  "space-xs": num(scale.space[0]),
  "space-sm": num(scale.space[1]),
  "space-md": num(scale.space[2]),
  "space-lg": num(scale.space[3]),
  "space-xl": num(scale.space[4]),
});
