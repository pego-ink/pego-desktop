import type { Skill } from "../types";
import { artDecoStyle } from "./modernism/art-deco";
import { artNouveauStyle } from "./modernism/art-nouveau";
import { bauhausStyle } from "./modernism/bauhaus";
import { deStijlStyle } from "./modernism/de-stijl";
import { italianFuturismStyle } from "./modernism/italian-futurism";
import { russianConstructivismStyle } from "./modernism/russian-constructivism";

/** Design-movement style skills (modernism group). Every entry has category: "style". */
export const modernismStyles: Skill[] = [
  bauhausStyle,
  deStijlStyle,
  russianConstructivismStyle,
  artDecoStyle,
  artNouveauStyle,
  italianFuturismStyle,
];
