import { findSkill, suggestSkills, suggestStyle, type Skill } from "@pego/agent";

export type ChipMode = "auto" | "manual" | "none";

/** One half of the chip: the design skill or the style skill. */
export type ChipPart = {
  /** auto = detected from the prompt, manual = user picked one, none = user chose "None". */
  mode: ChipMode;
  /** What the next run will use for this slot, if anything. */
  skill: Skill | undefined;
};

/** A piece of the pill text; `muted` for parts that were detected rather than picked. */
export type ChipText = { text: string; muted: boolean };

export type SkillChipView = {
  design: ChipPart;
  style: ChipPart;
  /** Pill text parts, joined with " · " on screen. Never empty. */
  parts: ChipText[];
  /** Plain-text summary for aria-label and tooltips. */
  label: string;
};

type Pool = readonly Skill[] | undefined;

const withPool = (pool: Pool) => (pool ? { skills: pool } : {});

const part = (
  id: string | null | undefined,
  category: "design" | "style",
  detect: () => Skill | undefined,
  pool: Pool,
): ChipPart => {
  if (id === null) return { mode: "none", skill: undefined };
  if (id !== undefined) {
    const picked = pool ? pool.find((skill) => skill.id === id) : findSkill(id);
    if (picked && !picked.core && (picked.category ?? "design") === category) {
      return { mode: "manual", skill: picked };
    }
  }
  return { mode: "auto", skill: detect() };
};

/**
 * What the composer chip shows. For each of `selectedId` (design) and `selectedStyleId`:
 * undefined = auto (best match for `prompt`), null = the user chose "None", string = picked.
 * The style part is only shown when there is a style (or the user picked one); the design part
 * always shows, with a neutral placeholder when nothing was detected.
 */
export const skillChipView = (
  prompt: string,
  selectedId: string | null | undefined,
  selectedStyleId: string | null | undefined,
  pool?: Pool,
): SkillChipView => {
  const design = part(
    selectedId,
    "design",
    () => suggestSkills(prompt, { limit: 1, ...withPool(pool) })[0],
    pool,
  );
  const style = part(selectedStyleId, "style", () => suggestStyle(prompt, withPool(pool)), pool);

  const parts: ChipText[] = [
    design.skill
      ? { text: design.skill.title, muted: design.mode === "auto" }
      : { text: design.mode === "none" ? "Core only" : "Skill", muted: true },
  ];
  if (style.skill) parts.push({ text: style.skill.title, muted: style.mode === "auto" });

  return { design, style, parts, label: parts.map((p) => p.text).join(" · ") };
};

/** Design skills the popover offers: every non-core, non-style skill, in registry order. */
export const pickableSkills = (pool: readonly Skill[]): Skill[] =>
  pool.filter((skill) => !skill.core && (skill.category ?? "design") === "design");

/** Style skills the popover offers, in registry order. */
export const pickableStyles = (pool: readonly Skill[]): Skill[] =>
  pool.filter((skill) => skill.category === "style");

export const STYLE_GROUPS = [
  "Modernism",
  "Mid-century",
  "Postmodern & expressive",
  "Digital",
  "More",
] as const;
export type StyleGroup = (typeof STYLE_GROUPS)[number];

const GROUP_IDS: Record<Exclude<StyleGroup, "More">, readonly string[]> = {
  Modernism: [
    "bauhaus",
    "de-stijl",
    "russian-constructivism",
    "art-deco",
    "art-nouveau",
    "italian-futurism",
  ],
  "Mid-century": [
    "swiss-international",
    "dieter-rams",
    "mid-century-modern",
    "japanese-minimalism",
    "scandinavian",
    "polish-poster-school",
  ],
  "Postmodern & expressive": [
    "memphis",
    "postmodern-new-wave",
    "grunge-typography",
    "psychedelic",
    "y2k-frutiger-aero",
    "retro-futurism-vaporwave",
  ],
  Digital: [
    "flat-design",
    "material-design",
    "skeuomorphism",
    "neumorphism",
    "glassmorphism",
    "neo-brutalism",
    "brutalist-web",
    "bento-grid",
    "editorial-magazine",
  ],
};

/** Era group of a style id; unknown ids land in "More". */
export const styleGroupOf = (id: string): StyleGroup =>
  (Object.keys(GROUP_IDS) as (keyof typeof GROUP_IDS)[]).find((group) =>
    GROUP_IDS[group].includes(id),
  ) ?? "More";

/** Case- and diacritic-insensitive title/id/description filter for the style list. */
export const filterStyles = (styles: readonly Skill[], query: string): Skill[] => {
  const needle = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!needle) return [...styles];
  return styles.filter((skill) =>
    `${skill.title} ${skill.id.replace(/-/g, " ")}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .includes(needle),
  );
};

/** Styles split into non-empty era groups, in STYLE_GROUPS order, registry order inside. */
export const groupStyles = (styles: readonly Skill[]): { group: StyleGroup; skills: Skill[] }[] =>
  STYLE_GROUPS.map((group) => ({
    group,
    skills: styles.filter((skill) => styleGroupOf(skill.id) === group),
  })).filter((entry) => entry.skills.length > 0);
