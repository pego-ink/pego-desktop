/** Pure helpers that turn GitHub release data into download links. No Astro, network or file I/O. */

export type Arch = "x64" | "arm64";
export type Platform = "macos" | "windows" | "linux";
export type LinuxFormat = "deb" | "rpm" | "AppImage" | "pacman" | "tar.gz";
export type OptionFormat = LinuxFormat | "zip";

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

export interface Release {
  /** "0.1.0-beta" (the tag without its leading "v"). */
  version: string;
  tag: string;
  /** The release page on GitHub. */
  url: string;
  publishedAt: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

export interface DownloadOption {
  platform: Platform;
  arch: Arch;
  /** Linux package format; undefined for macOS and Windows. */
  format?: OptionFormat;
  url: string;
  size: number;
  name: string;
}

export interface ReleaseDownloads {
  macos: DownloadOption[];
  /** Installers (.exe). */
  windows: DownloadOption[];
  /** Portable Windows builds (`*-win-<arch>.zip`), shown as a secondary link. */
  windowsPortable: DownloadOption[];
  linux: DownloadOption[];
  checksumsUrl?: string;
}

export const ARCH_LABEL: Record<Arch, string> = { x64: "x64", arm64: "ARM64" };
export const MAC_ARCH_LABEL: Record<Arch, string> = { x64: "Intel", arm64: "Apple silicon" };
export const LINUX_FORMATS: readonly LinuxFormat[] = ["deb", "rpm", "AppImage", "pacman", "tar.gz"];
const ARCHS: readonly Arch[] = ["x64", "arm64"];

const ARM_TOKEN = /(?:^|[-_.])(?:arm64|aarch64)(?=[-_.]|$)/i;
const X64_TOKEN = /(?:^|[-_.])(?:x64|x86_64|amd64)(?=[-_.]|$)/i;

/** Arch from a file name token (arm64 / aarch64 / x64 / x86_64 / amd64), or undefined. */
export const detectArch = (name: string): Arch | undefined => {
  if (ARM_TOKEN.test(name)) return "arm64";
  if (X64_TOKEN.test(name)) return "x64";
  return undefined;
};

const lower = (name: string) => name.toLowerCase();

const detectLinuxFormat = (name: string): LinuxFormat | undefined => {
  const n = lower(name);
  if (n.endsWith(".deb")) return "deb";
  if (n.endsWith(".rpm")) return "rpm";
  if (n.endsWith(".appimage")) return "AppImage";
  if (n.endsWith(".pacman")) return "pacman";
  if (n.endsWith(".tar.gz")) return "tar.gz";
  return undefined;
};

const CHECKSUMS = /^sha256sums(\.txt)?$/i;

/** Group a release's assets by platform. Unknown files, zip, yml and blockmap are ignored. */
export const groupReleaseAssets = (assets: ReleaseAsset[]): ReleaseDownloads => {
  const result: ReleaseDownloads = { macos: [], windows: [], windowsPortable: [], linux: [] };
  for (const asset of assets) {
    const base = { url: asset.url, size: asset.size, name: asset.name };
    if (CHECKSUMS.test(asset.name)) {
      result.checksumsUrl = asset.url;
      continue;
    }
    const arch = detectArch(asset.name);
    if (!arch) continue;
    const n = lower(asset.name);
    if (n.endsWith(".dmg")) result.macos.push({ ...base, platform: "macos", arch });
    else if (n.endsWith(".exe")) result.windows.push({ ...base, platform: "windows", arch });
    // macOS updater zips (`-arm64.zip`) carry no "win" token and stay ignored.
    else if (n.endsWith(".zip") && /(?:^|[-_.])win(?:dows)?(?=[-_.])/.test(n))
      result.windowsPortable.push({ ...base, platform: "windows", arch, format: "zip" });
    else {
      const format = detectLinuxFormat(asset.name);
      if (format) result.linux.push({ ...base, platform: "linux", arch, format });
    }
  }
  const byArch = (a: DownloadOption, b: DownloadOption) =>
    ARCHS.indexOf(a.arch) - ARCHS.indexOf(b.arch);
  // Apple silicon first on macOS, x64 first elsewhere.
  result.macos.sort((a, b) => byArch(b, a));
  result.windows.sort(byArch);
  result.windowsPortable.sort(byArch);
  result.linux.sort(
    (a, b) =>
      LINUX_FORMATS.indexOf(a.format as LinuxFormat) -
        LINUX_FORMATS.indexOf(b.format as LinuxFormat) || byArch(a, b),
  );
  return result;
};

/** True when there is at least one installer to link to. */
export const hasInstallers = (d: ReleaseDownloads) =>
  d.macos.length + d.windows.length + d.linux.length > 0;

/** Linux options grouped by package format, in display order. */
export const groupLinuxByFormat = (linux: DownloadOption[]) =>
  LINUX_FORMATS.flatMap((format) => {
    const options = linux.filter((o) => o.format === format);
    return options.length > 0 ? [{ format, options }] : [];
  });

/** "142 MB" (binary megabytes, like the GitHub UI), "812 KB" under one megabyte. */
export const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
};

/** Accessible name, e.g. "Download for macOS, Apple silicon, 142 MB". */
export const downloadLabel = (o: DownloadOption) => {
  const parts =
    o.platform === "macos"
      ? ["macOS", MAC_ARCH_LABEL[o.arch]]
      : o.platform === "windows"
        ? ["Windows", o.format === "zip" ? "portable zip" : "", ARCH_LABEL[o.arch]]
        : ["Linux", o.format ?? "", ARCH_LABEL[o.arch]];
  return `Download for ${[...parts, formatSize(o.size)].filter(Boolean).join(", ")}`;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Published (non-draft) releases from the GitHub API list response, newest first. Bad rows are skipped. */
export const parseReleases = (json: unknown): Release[] => {
  if (!Array.isArray(json)) return [];
  const releases: Release[] = [];
  for (const row of json) {
    if (!isRecord(row) || row.draft !== false) continue;
    const { tag_name: tag, html_url: url } = row;
    if (typeof tag !== "string" || typeof url !== "string") continue;
    const assets: ReleaseAsset[] = [];
    for (const a of Array.isArray(row.assets) ? row.assets : []) {
      if (!isRecord(a)) continue;
      if (
        typeof a.name === "string" &&
        typeof a.size === "number" &&
        typeof a.browser_download_url === "string"
      )
        assets.push({ name: a.name, size: a.size, url: a.browser_download_url });
    }
    releases.push({
      version: tag.replace(/^v/, ""),
      tag,
      url,
      publishedAt: typeof row.published_at === "string" ? row.published_at : "",
      prerelease: row.prerelease === true,
      assets,
    });
  }
  return releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
};

export interface DownloadTargets {
  /** Entry id to the release whose download block it shows (the newest entry of that version). */
  byEntry: Map<string, Release>;
  /** The newest release that has a changelog entry and installers, for the header button. */
  latest?: Release;
}

/**
 * Decide where download UI appears. `entries` are newest first. A release only counts when it has
 * installers and at least one entry with that version (so an unlisted release is never advertised).
 */
export const pickDownloadTargets = (
  entries: { id: string; version?: string }[],
  releases: Release[],
): DownloadTargets => {
  const usable = new Map(
    releases.filter((r) => hasInstallers(groupReleaseAssets(r.assets))).map((r) => [r.version, r]),
  );
  const byEntry = new Map<string, Release>();
  const seen = new Set<string>();
  for (const { id, version } of entries) {
    if (!version || seen.has(version)) continue;
    seen.add(version);
    const release = usable.get(version);
    if (release) byEntry.set(id, release);
  }
  const latest = releases.find((r) => seen.has(r.version) && usable.has(r.version));
  return { byEntry, latest };
};
