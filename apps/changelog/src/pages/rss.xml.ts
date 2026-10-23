import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getEntries } from "@/lib/entries";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const GET = async (context: APIContext) => {
  const entries = await getEntries();
  return rss({
    title: `${SITE_NAME} changelog`,
    description: SITE_DESCRIPTION,
    site: context.site ?? "https://changelog.pego.ink",
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.date,
      link: `/${entry.id}`,
      categories: entry.data.tags,
    })),
    trailingSlash: false,
    customData: "<language>en</language>",
  });
};
