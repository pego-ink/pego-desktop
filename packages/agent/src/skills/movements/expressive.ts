import type { Skill } from "../types";
import { grungeTypographySkill } from "./expressive/grunge-typography";
import { memphisSkill } from "./expressive/memphis";
import { postmodernNewWaveSkill } from "./expressive/postmodern-new-wave";
import { psychedelicSkill } from "./expressive/psychedelic";
import { retroFuturismVaporwaveSkill } from "./expressive/retro-futurism-vaporwave";
import { y2kFrutigerAeroSkill } from "./expressive/y2k-frutiger-aero";

/** Design-movement style skills (expressive group). Every entry has category: "style". */
export const expressiveStyles: Skill[] = [
  memphisSkill,
  postmodernNewWaveSkill,
  grungeTypographySkill,
  psychedelicSkill,
  y2kFrutigerAeroSkill,
  retroFuturismVaporwaveSkill,
];
