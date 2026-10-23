import { brandIdentitySkill } from "./system/brand-identity";
import { coreSkill } from "./system/core";
import { dashboardSkill } from "./system/dashboard";
import { designSystemSkill } from "./system/design-system";
import { slidesSkill } from "./system/slides";
import { socialMediaSkill } from "./system/social-media";
import { uiPolishSkill } from "./system/ui-polish";
import type { Skill } from "./types";

/** Core anti-slop and UI polish skills plus dashboard, slides, design system, social, brand. */
export const systemSkills: Skill[] = [
  coreSkill,
  uiPolishSkill,
  dashboardSkill,
  slidesSkill,
  designSystemSkill,
  socialMediaSkill,
  brandIdentitySkill,
];
