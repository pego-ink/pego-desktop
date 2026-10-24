/**
 * Nightly desktop builds (`.github/workflows/nightly.yml`): version, "anything new?" and retention.
 * Pure functions plus a small CLI so the workflow stays shell glue.
 *
 *   gh api --paginate --slurp repos/OWNER/REPO/releases \
 *     | bun .github/scripts/nightly.ts plan <headSha> <package version> <YYYYMMDD> <run number> <run attempt> <force>
 *       -> key=value lines for $GITHUB_OUTPUT: build, version, previous_tag, previous_sha
 *   ... | bun .github/scripts/nightly.ts expired <keep>
 *       -> one nightly tag per line: the ones to delete, keeping the newest <keep>
 */

/** The fields of GitHub's release JSON that we read. */
export type ReleaseInfo = {
  tag_name?: unknown;
  target_commitish?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  published_at?: unknown;
};

export type NightlyRelease = { tag: string; sha: string; publishedAt: number };

/** `v<x.y.z>-nightly.<YYYYMMDD>.<run>.<attempt>`: the only tags this workflow creates, and the only ones it may delete. */
export const NIGHTLY_TAG = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.\d+$/;

/** Default number of nightly releases kept. */
export const KEEP_NIGHTLIES = 7;

/** `0.1.0-beta` -> `0.1.0` (prerelease and build parts dropped). */
export const baseVersion = (packageVersion: string): string => {
  const match = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(packageVersion.trim());
  if (!match) throw new Error(`not a semver version: ${packageVersion}`);
  return match[1]!;
};

/**
 * `<base>-nightly.<YYYYMMDD>.<run>.<attempt>`. Semver compares the date, the run number, then the
 * attempt, as numbers, so a later nightly always sorts newer; it also sorts above `<base>-beta`
 * ("nightly" > "beta"). The attempt keeps a re-run of a failed run from reusing the tag of a release
 * its first attempt may have created.
 */
export const nightlyVersion = (
  packageVersion: string,
  date: string,
  run: string,
  attempt: string,
): string => {
  if (!/^\d{8}$/.test(date)) throw new Error(`date must be YYYYMMDD: ${date}`);
  if (!/^[1-9]\d*$/.test(run)) throw new Error(`run number must be a positive integer: ${run}`);
  if (!/^[1-9]\d*$/.test(attempt))
    throw new Error(`run attempt must be a positive integer: ${attempt}`);
  return `${baseVersion(packageVersion)}-nightly.${date}.${run}.${attempt}`;
};

const flatten = (value: unknown): ReleaseInfo[] =>
  Array.isArray(value) ? value.flatMap((item) => (Array.isArray(item) ? item : [item])) : [];

/** Published nightly prereleases, newest first. Drafts, stable and beta releases never appear. */
export const nightlyReleases = (releases: unknown): NightlyRelease[] =>
  flatten(releases)
    .flatMap((release): NightlyRelease[] => {
      if (!release || typeof release !== "object") return [];
      const { tag_name, target_commitish, prerelease, draft, published_at } = release;
      if (typeof tag_name !== "string" || !NIGHTLY_TAG.test(tag_name)) return [];
      if (prerelease !== true || draft === true) return [];
      const publishedAt = typeof published_at === "string" ? Date.parse(published_at) : NaN;
      if (Number.isNaN(publishedAt)) return [];
      const sha = typeof target_commitish === "string" ? target_commitish : "";
      return [{ tag: tag_name, sha, publishedAt }];
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);

export type NightlyPlan = {
  build: boolean;
  previousTag: string;
  previousSha: string;
};

/** Build unless `dev` is still at the commit of the newest nightly (or `force`). */
export const planNightly = (headSha: string, releases: unknown, force: boolean): NightlyPlan => {
  const previous = nightlyReleases(releases)[0];
  const previousSha = previous && /^[0-9a-f]{40}$/.test(previous.sha) ? previous.sha : "";
  return {
    build: force || !previous || previousSha !== headSha,
    previousTag: previous?.tag ?? "",
    previousSha,
  };
};

/** Nightly tags to delete: everything but the newest `keep`. */
export const expiredNightlyTags = (releases: unknown, keep: number = KEEP_NIGHTLIES): string[] =>
  nightlyReleases(releases)
    .slice(Math.max(0, keep))
    .map((release) => release.tag);

const readStdinJson = async (): Promise<unknown> => {
  const text = await Bun.stdin.text();
  return text.trim() === "" ? [] : JSON.parse(text);
};

const main = async (): Promise<void> => {
  const [command, ...args] = Bun.argv.slice(2);
  if (command === "plan") {
    const [headSha, packageVersion, date, run, attempt, force] = args;
    if (!headSha || !/^[0-9a-f]{40}$/.test(headSha))
      throw new Error("head sha must be 40 hex chars");
    const plan = planNightly(headSha, await readStdinJson(), force === "true");
    const version = nightlyVersion(packageVersion ?? "", date ?? "", run ?? "", attempt ?? "");
    console.log(`build=${plan.build}`);
    console.log(`version=${version}`);
    console.log(`previous_tag=${plan.previousTag}`);
    console.log(`previous_sha=${plan.previousSha}`);
    return;
  }
  if (command === "expired") {
    const keep = Number(args[0] ?? KEEP_NIGHTLIES);
    if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be a positive integer");
    for (const tag of expiredNightlyTags(await readStdinJson(), keep)) console.log(tag);
    return;
  }
  throw new Error("usage: nightly.ts plan|expired ...");
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
