import { landingPageSkill } from "./build/landing-page";
import { marketingSiteSkill } from "./build/marketing-site";
import { mobileAppSkill } from "./build/mobile-app";
import { webAppSkill } from "./build/web-app";
import type { Skill } from "./types";

/** Skills for screens and sites: landing page, web app, mobile app, marketing site. */
export const buildSkills: Skill[] = [
  landingPageSkill,
  webAppSkill,
  mobileAppSkill,
  marketingSiteSkill,
];
