import type { Skill } from "../types";
import { bentoGridSkill } from "./digital/bento-grid";
import { brutalistWebSkill } from "./digital/brutalist-web";
import { editorialMagazineSkill } from "./digital/editorial-magazine";
import { flatDesignSkill } from "./digital/flat-design";
import { glassmorphismSkill } from "./digital/glassmorphism";
import { materialDesignSkill } from "./digital/material-design";
import { neoBrutalismSkill } from "./digital/neo-brutalism";
import { neumorphismSkill } from "./digital/neumorphism";
import { skeuomorphismSkill } from "./digital/skeuomorphism";
import { teenageEngineeringSkill } from "./digital/teenage-engineering";

/** Design-movement style skills (digital group). Every entry has category: "style". */
export const digitalStyles: Skill[] = [
  skeuomorphismSkill,
  flatDesignSkill,
  materialDesignSkill,
  neumorphismSkill,
  glassmorphismSkill,
  neoBrutalismSkill,
  brutalistWebSkill,
  bentoGridSkill,
  editorialMagazineSkill,
  teenageEngineeringSkill,
];
