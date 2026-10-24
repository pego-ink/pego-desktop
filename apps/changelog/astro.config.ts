import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { safeMarkdown } from "./src/lib/safe-markdown";

export default defineConfig({
  site: "https://changelog.pego.ink",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "always" },
  // safeMarkdown: drops raw HTML and unsafe link/image URLs from entry markdown.
  integrations: [safeMarkdown(), sitemap()],
});
