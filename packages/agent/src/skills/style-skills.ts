import { digitalStyles } from "./movements/digital";
import { expressiveStyles } from "./movements/expressive";
import { midcenturyStyles } from "./movements/midcentury";
import { modernismStyles } from "./movements/modernism";
import type { Skill } from "./types";

/** Visual-language skills from design history and practice (category "style"). */
export const styleSkills: Skill[] = [
  ...modernismStyles,
  ...midcenturyStyles,
  ...expressiveStyles,
  ...digitalStyles,
];
