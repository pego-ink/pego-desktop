/**
 * Release assets from the per-platform build artifacts (release.yml, nightly.yml).
 *
 *   bun .github/scripts/assemble-release.ts <artifacts dir> <out dir>
 *
 * The artifacts dir holds one folder per uploaded artifact (macos, linux-x64, windows-arm64, ...).
 * Everything lands flat in the out dir plus SHA256SUMS.txt. electron-updater feed files (`*.yml`)
 * are merged when several artifacts carry the same name: Windows has one `latest.yml` for both
 * arches (the updater picks the entry whose file name has its arch), but x64 and arm64 are built on
 * their own runners, so each artifact holds a feed with only its own installer.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

type FeedFile = { url: string; [key: string]: unknown };
type Feed = { version: string; files: FeedFile[]; [key: string]: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseFeed = (text: string, name: string): Feed => {
  const feed: unknown = Bun.YAML.parse(text);
  if (!isRecord(feed) || typeof feed.version !== "string" || !Array.isArray(feed.files)) {
    throw new Error(`${name}: not an update feed (needs version and files)`);
  }
  for (const file of feed.files) {
    if (!isRecord(file) || typeof file.url !== "string")
      throw new Error(`${name}: bad files entry`);
  }
  return feed as Feed;
};

/** Merges feeds of one channel file: first feed's fields, union of `files` by url. Same version only. */
export const mergeFeeds = (texts: readonly { name: string; text: string }[]): string => {
  const [first, ...rest] = texts.map(({ name, text }) => parseFeed(text, name));
  if (!first) throw new Error("no feed to merge");
  const files = [...first.files];
  for (const [index, feed] of rest.entries()) {
    if (feed.version !== first.version) {
      throw new Error(
        `${texts[index + 1]!.name}: version ${feed.version} differs from ${first.version}`,
      );
    }
    for (const file of feed.files) {
      if (!files.some((known) => known.url === file.url)) files.push(file);
    }
  }
  const text = Bun.YAML.stringify({ ...first, files }, null, 2);
  // Keep the date a string like electron-builder writes it (unquoted, js-yaml loads a Date).
  return text.replace(/^releaseDate: (\d{4}-[^'"\n]*)$/m, "releaseDate: '$1'") + "\n";
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]),
    ),
  );
  return nested.flat();
};

/** x64 first: the feed's legacy top-level path/sha512 then point at the x64 installer. */
const feedOrder = (a: string, b: string): number =>
  Number(a.includes("arm64")) - Number(b.includes("arm64")) || a.localeCompare(b);

/** `sha256sum -c` format: "<hash>  <name>", names sorted bytewise. */
export const sha256Sums = (entries: readonly { name: string; data: Uint8Array }[]): string =>
  [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, data }) => `${createHash("sha256").update(data).digest("hex")}  ${name}`)
    .join("\n") + "\n";

export const assembleRelease = async (artifactsDir: string, outDir: string): Promise<string[]> => {
  await mkdir(outDir, { recursive: true });
  const files = (await walk(artifactsDir)).sort(feedOrder);
  const plain = new Map<string, string>();
  const feeds = new Map<string, string[]>();
  for (const file of files) {
    const name = basename(file);
    if (name === "SHA256SUMS.txt") continue;
    if (name.endsWith(".yml")) {
      feeds.set(name, [...(feeds.get(name) ?? []), file]);
    } else if (plain.has(name)) {
      throw new Error(`${name} appears in more than one artifact`);
    } else {
      plain.set(name, file);
    }
  }
  for (const [name, source] of plain) await copyFile(source, join(outDir, name));
  for (const [name, sources] of feeds) {
    const texts = await Promise.all(
      sources.map(async (source) => ({ name: source, text: await readFile(source, "utf8") })),
    );
    await writeFile(join(outDir, name), mergeFeeds(texts));
  }
  const names = [...plain.keys(), ...feeds.keys()];
  const entries = await Promise.all(
    names.map(async (name) => ({ name, data: await readFile(join(outDir, name)) })),
  );
  await writeFile(join(outDir, "SHA256SUMS.txt"), sha256Sums(entries));
  return [...names, "SHA256SUMS.txt"];
};

if (import.meta.main) {
  const [artifactsDir, outDir] = Bun.argv.slice(2);
  if (!artifactsDir || !outDir) {
    console.error("usage: assemble-release.ts <artifacts dir> <out dir>");
    process.exit(1);
  }
  assembleRelease(artifactsDir, outDir).then(
    (names) => console.log(names.join("\n")),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
