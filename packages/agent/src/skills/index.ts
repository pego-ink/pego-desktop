import { buildSkills } from "./build-skills";
import { styleSkills } from "./style-skills";
import { systemSkills } from "./system-skills";
import type { Skill } from "./types";

export type { Skill } from "./types";

/** Every built-in skill; the core skill (if any) first. */
export const skills: Skill[] = [...systemSkills, ...buildSkills, ...styleSkills].sort(
  (a, b) => Number(b.core === true) - Number(a.core === true),
);

export const findSkill = (id: string): Skill | undefined => {
  const key = id
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return skills.find((skill) => skill.id === key);
};

export const coreSkill = (): Skill | undefined => skills.find((skill) => skill.core);
