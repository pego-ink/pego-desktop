/**
 * Update channel: which line of releases the auto-updater follows. Mirrors `UpdateChannel` in
 * apps/web/src/desktop/desktop-api.ts (the two packages do not share code, keep them in sync).
 *
 * - "stable": the newest published stable release (GitHub's "latest").
 * - "nightly": the newest `-nightly.` prerelease built from dev (.github/workflows/nightly.yml).
 */
export const UPDATE_CHANNEL_IDS = ["stable", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNEL_IDS)[number];

export const isUpdateChannel = (value: unknown): value is UpdateChannel =>
  typeof value === "string" && (UPDATE_CHANNEL_IDS as readonly string[]).includes(value);

/** Channel a build belongs to when the user never chose one: nightlies follow nightlies. */
export const channelFromVersion = (version: string): UpdateChannel =>
  /-nightly\./.test(version) ? "nightly" : "stable";

/** The electron-updater settings a channel needs; a missing key is left at its default. */
export type FeedSettings = {
  channel?: string;
  allowPrerelease?: boolean;
  allowDowngrade?: boolean;
};

/**
 * electron-updater settings for the chosen channel (`preference` null = never chosen).
 *
 * - nightly: `channel = "nightly"` makes the GitHub provider take the newest release whose tag has
 *   the `nightly` prerelease id and read `nightly[-mac|-linux[-arm64]].yml`; needs allowPrerelease.
 *   Downgrade is allowed: a nightly of an already released base version sorts below that stable.
 * - stable, chosen explicitly: `channel = "beta"` with allowPrerelease on makes the GitHub provider take
 *   the newest release that is beta or stable and skip nightlies (any other prerelease id), then read
 *   `beta*.yml` and fall back to `latest*.yml` (the files we publish). Not GitHub's "latest" release:
 *   it does not exist while only `-beta` prereleases are published. Downgrade is allowed so leaving
 *   nightly installs the stable (or beta) build.
 * - stable, never chosen: nothing is touched, so electron-updater keeps its own defaults from the
 *   installed version (a stable build sees stable releases, a `-beta` build beta and stable ones,
 *   and neither ever sees a nightly: the GitHub provider skips custom prerelease ids).
 */
export const feedSettings = (preference: UpdateChannel | null, version: string): FeedSettings => {
  const channel = preference ?? channelFromVersion(version);
  if (channel === "nightly") {
    return { channel: "nightly", allowPrerelease: true, allowDowngrade: true };
  }
  if (preference === null) return {};
  return { channel: "beta", allowPrerelease: true, allowDowngrade: true };
};

/**
 * Whether this install can update itself. macOS always; Windows only for the NSIS install (the
 * portable zip has no uninstaller next to the exe); Linux only for the AppImage (APPIMAGE is set
 * by its runtime; deb, rpm, pacman and tar.gz are updated by hand).
 */
export const canAutoUpdate = (env: {
  platform: NodeJS.Platform;
  appImage: string | undefined;
  hasUninstaller: boolean;
}): boolean => {
  switch (env.platform) {
    case "darwin":
      return true;
    case "win32":
      return env.hasUninstaller;
    case "linux":
      return typeof env.appImage === "string" && env.appImage !== "";
    default:
      return false;
  }
};
