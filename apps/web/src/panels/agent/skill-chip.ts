import { findSkill, suggestSkills, type Skill } from "@pego/agent";

export type SkillChipView = {
  /** auto = detected from the prompt, manual = user picked one, none = core only (user's choice). */
  mode: "auto" | "manual" | "none";
  /** The skill the next run will use besides core, if any. */
  skill: Skill | undefined;
  /** Main pill text. */
  label: string;
  /** Muted suffix after the label ("auto"), or null. */
  suffix: string | null;
};

/**
 * What the composer chip shows. `selectedId`: undefined = auto (the best match for `prompt`),
 * null = the user chose "None (core only)", string = the user picked that skill.
 */
export const skillChipView = (
  prompt: string,
  selectedId: string | null | undefined,
  pool?: readonly Skill[],
): SkillChipView => {
  if (selectedId === null)
    return { mode: "none", skill: undefined, label: "Core only", suffix: null };
  if (selectedId !== undefined) {
    const picked = pool ? pool.find((skill) => skill.id === selectedId) : findSkill(selectedId);
    if (picked) return { mode: "manual", skill: picked, label: picked.title, suffix: null };
  }
  const [detected] = suggestSkills(prompt, { limit: 1, ...(pool ? { skills: pool } : {}) });
  return detected
    ? { mode: "auto", skill: detected, label: detected.title, suffix: "auto" }
    : { mode: "auto", skill: undefined, label: "Skill", suffix: "auto" };
};

/** Skills the popover offers: every non-core skill, in registry order. */
export const pickableSkills = (pool: readonly Skill[]): Skill[] =>
  pool.filter((skill) => !skill.core);
