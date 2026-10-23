import { z } from "astro/zod";

export const TAGS = ["new", "improved", "fixed"] as const;

/** Frontmatter of one changelog entry. `image` is Astro's image() helper in the site, any schema in tests. */
export const entrySchema = <I extends z.ZodType>(image: () => I) =>
  z
    .object({
      title: z.string().min(1).max(80),
      date: z.coerce.date(),
      /** Meta description and list text. */
      summary: z.string().min(1).max(160),
      tags: z.array(z.enum(TAGS)).min(1),
      version: z.string().optional(),
      image: image().optional(),
      imageAlt: z.string().min(1).optional(),
    })
    .refine((entry) => !entry.image || entry.imageAlt, {
      message: "imageAlt is required when image is set",
      path: ["imageAlt"],
    });

export type Tag = (typeof TAGS)[number];
