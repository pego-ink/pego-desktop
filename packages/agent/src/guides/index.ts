import { componentsAndTokensGuide } from "./components-and-tokens";
import { dashboardGuide } from "./dashboard";
import { landingPageGuide } from "./landing-page";
import { mobileAppGuide } from "./mobile-app";
import { overviewGuide } from "./overview";
import { typographyAndColorGuide } from "./typography-and-color";
import type { Guide } from "./types";
import { webAppGuide } from "./web-app";

export type { Guide } from "./types";

/** Design guidance served as MCP resources and through the `get_guidelines` tool. */
export const guides: Guide[] = [
  overviewGuide,
  webAppGuide,
  mobileAppGuide,
  landingPageGuide,
  dashboardGuide,
  componentsAndTokensGuide,
  typographyAndColorGuide,
];

export const findGuide = (id: string): Guide | undefined =>
  guides.find(
    (guide) =>
      guide.id ===
      id
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-"),
  );
