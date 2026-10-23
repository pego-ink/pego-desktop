import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { entrySchema } from "@/content/schema";

const entries = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/entries" }),
  schema: ({ image }) => entrySchema(image),
});

export const collections = { entries };
