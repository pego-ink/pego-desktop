import { getCollection } from "astro:content";

/** All entries, newest first (ties keep the slug order so the list is stable). */
export const getEntries = async () =>
  (await getCollection("entries")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id),
  );
