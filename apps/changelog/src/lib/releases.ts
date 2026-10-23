import { readFileSync } from "node:fs";
import { parseReleases, type Release } from "@/lib/release-assets";

const API = "https://api.github.com/repos/pego-ink/pego-desktop/releases?per_page=50";

const load = async (): Promise<Release[]> => {
  try {
    // Tests and local dev only: a JSON file in the shape of the GitHub API response.
    const fixture = process.env.PEGO_RELEASES_FIXTURE;
    if (fixture) return parseReleases(JSON.parse(readFileSync(fixture, "utf8")));

    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "pego-changelog-build",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub API answered ${response.status}`);
    return parseReleases(await response.json());
  } catch (error) {
    console.warn(
      `[releases] could not load GitHub releases, building without download buttons: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

let cached: Promise<Release[]> | undefined;

/** Published releases of the desktop app, fetched once per build. Never throws. */
export const getReleases = () => (cached ??= load());
