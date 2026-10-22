import type { Skill } from "../types";
import { dieterRamsSkill } from "./midcentury/dieter-rams";
import { japaneseMinimalismSkill } from "./midcentury/japanese-minimalism";
import { midCenturyModernSkill } from "./midcentury/mid-century-modern";
import { polishPosterSchoolSkill } from "./midcentury/polish-poster-school";
import { scandinavianSkill } from "./midcentury/scandinavian";
import { swissInternationalSkill } from "./midcentury/swiss-international";

/** Design-movement style skills (midcentury group). Every entry has category: "style". */
export const midcenturyStyles: Skill[] = [
  swissInternationalSkill,
  dieterRamsSkill,
  midCenturyModernSkill,
  japaneseMinimalismSkill,
  scandinavianSkill,
  polishPosterSchoolSkill,
];
