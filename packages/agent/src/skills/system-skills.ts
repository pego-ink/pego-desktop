import { brandIdentitySkill } from "./system/brand-identity";
import { coreSkill } from "./system/core";
import { dashboardSkill } from "./system/dashboard";
import { designSystemSkill } from "./system/design-system";
import { slidesSkill } from "./system/slides";
import { socialMediaSkill } from "./system/social-media";
import type { Skill } from "./types";

/** Core anti-slop skill plus dashboard, slides, design system, social, brand. */
export const systemSkills: Skill[] = [
  coreSkill,
  dashboardSkill,
  slidesSkill,
  designSystemSkill,
  socialMediaSkill,
  brandIdentitySkill,
];
