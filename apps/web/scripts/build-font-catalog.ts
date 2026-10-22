/**
 * Builds apps/web/src/fonts/google-fonts.json (committed). Run: `bun run scripts/build-font-catalog.ts`
 *
 * Sources (public, no API key):
 *  - https://fonts.google.com/metadata/fonts  -> family list, category, weights, popularity rank
 *  - google/fonts repo METADATA.pb (via cdn.jsdelivr.net, pinned to a commit) -> TTF file names +
 *    variable `wght` axis range, so the app can fetch parseable TTFs (CanvasKit cannot use the WOFF2
 *    that fonts.googleapis.com serves to browsers; see font-service.ts).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compactFile } from "../src/fonts/catalog";

type MetadataFont = {
  family: string;
  category: string;
  popularity: number;
  fonts: Record<string, unknown>;
};
type FaceEntry = [italic: 0 | 1, weight: number, file: string];

const OUT = resolve(import.meta.dir, "../src/fonts/google-fonts.json");
const CATEGORIES = ["sans-serif", "serif", "display", "handwriting", "monospace"] as const;
const CATEGORY_BY_NAME: Record<string, number> = {
  "Sans Serif": 0,
  Serif: 1,
  Display: 2,
  Handwriting: 3,
  Monospace: 4,
};
const LICENSE_DIRS = ["ofl", "apache", "ufl"] as const;
const CONCURRENCY = 16;

const getText = async (url: string): Promise<string | null> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (res.ok) return await res.text();
    } catch {
      // retry
    }
    await Bun.sleep(300 * (attempt + 1));
  }
  return null;
};

const slugOf = (family: string) => family.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Weights offered by a family from the metadata `fonts` keys ("400", "400i"). */
const parseWeights = (fonts: Record<string, unknown>) => {
  const normal: number[] = [];
  const italic: number[] = [];
  for (const key of Object.keys(fonts)) {
    // A few variable families start their wght axis at 1; the picker only deals in CSS weights >= 100.
    const weight = Math.max(100, Number.parseInt(key, 10));
    const list = key.endsWith("i") ? italic : normal;
    if (!list.includes(weight)) list.push(weight);
  }
  return { normal: normal.toSorted((a, b) => a - b), italic: italic.toSorted((a, b) => a - b) };
};

type ParsedPb = { faces: FaceEntry[]; variable: boolean };

/** Minimal METADATA.pb reader: `fonts { style/weight/filename }` blocks and `axes { tag: "wght" }`. */
export const parseMetadataPb = (pb: string): ParsedPb => {
  const faces: FaceEntry[] = [];
  for (const block of pb.matchAll(/^fonts \{([\s\S]*?)^\}/gm)) {
    const body = block[1] ?? "";
    const style = /style: "(\w+)"/.exec(body)?.[1];
    const weight = /weight: (\d+)/.exec(body)?.[1];
    const file = /filename: "([^"]+)"/.exec(body)?.[1];
    if (!style || !weight || !file) continue;
    faces.push([style === "italic" ? 1 : 0, Number(weight), file]);
  }
  const variable = [...pb.matchAll(/^axes \{([\s\S]*?)^\}/gm)].some((m) =>
    /tag: "wght"/.test(m[1] ?? ""),
  );
  return { faces, variable };
};

const mapPool = async <T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return results;
};

const main = async () => {
  const [metaText, sha] = await Promise.all([
    getText("https://fonts.google.com/metadata/fonts"),
    getText("https://api.github.com/repos/google/fonts/commits/main").then((text) =>
      text ? (JSON.parse(text) as { sha: string }).sha : null,
    ),
  ]);
  if (!metaText || !sha) throw new Error("could not fetch metadata or the google/fonts commit");
  const list = (JSON.parse(metaText) as { familyMetadataList: MetadataFont[] }).familyMetadataList;

  const missing: string[] = [];
  const rows = await mapPool(list, async (meta) => {
    const slug = slugOf(meta.family);
    let dir = "";
    let parsed: ParsedPb | null = null;
    for (const candidate of LICENSE_DIRS) {
      const pb = await getText(
        `https://cdn.jsdelivr.net/gh/google/fonts@${sha}/${candidate}/${slug}/METADATA.pb`,
      );
      if (!pb) continue;
      dir = candidate;
      parsed = parseMetadataPb(pb);
      break;
    }
    if (!parsed || parsed.faces.length === 0) missing.push(meta.family);
    const weights = parseWeights(meta.fonts);
    // Tuple: [family, category, popularity, normalWeights, italicWeights, dir ("" = ofl), variable(0|1), faces]
    return [
      meta.family,
      CATEGORY_BY_NAME[meta.category] ?? 2,
      meta.popularity,
      weights.normal,
      weights.italic,
      dir === "ofl" ? "" : dir,
      parsed?.variable ? 1 : 0,
      (parsed?.faces ?? []).map(([italic, weight, file]) => [
        italic,
        weight,
        compactFile(meta.family, file),
      ]),
    ];
  });

  // Families renamed upstream still appear in the metadata list but have no font files: drop them.
  const families = rows.filter((row) => (row[7] as unknown[]).length > 0);
  families.sort((a, b) => (a[2] as number) - (b[2] as number));
  const json = JSON.stringify({ ref: sha, categories: CATEGORIES, families });
  writeFileSync(OUT, json);
  console.log(
    `wrote ${OUT}: ${families.length} families, ${(json.length / 1024).toFixed(0)} KB, ref ${sha}`,
  );
  if (missing.length > 0)
    console.log(
      `dropped, no METADATA.pb for ${missing.length}: ${missing.slice(0, 20).join(", ")}`,
    );
};

if (import.meta.main) await main();
