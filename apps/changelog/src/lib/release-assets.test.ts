import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectArch,
  downloadLabel,
  formatSize,
  groupLinuxByFormat,
  groupReleaseAssets,
  parseReleases,
  pickDownloadTargets,
} from "@/lib/release-assets";

const fixture: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "../../fixtures/releases.json"), "utf8"),
);
const releases = parseReleases(fixture);
const v010 = releases.find((r) => r.version === "0.1.0-beta");
const v001 = releases.find((r) => r.version === "0.0.1-beta");

describe("parseReleases", () => {
  test("drops drafts, strips the v and sorts newest first", () => {
    expect(releases.map((r) => r.version)).toEqual(["0.1.0-beta", "0.0.1-beta"]);
  });
  test("tolerates garbage", () => {
    expect(parseReleases(null)).toEqual([]);
    expect(parseReleases([1, { draft: false }, { draft: false, tag_name: "v1" }])).toEqual([]);
  });
});

describe("detectArch", () => {
  test.each([
    ["Pego-1.0.0-arm64.dmg", "arm64"],
    ["pego_1.0.0_amd64.deb", "x64"],
    ["pego-1.0.0.x86_64.rpm", "x64"],
    ["pego-1.0.0.aarch64.rpm", "arm64"],
    ["Pego-1.0.0-linux-arm64.AppImage", "arm64"],
    ["Pego-1.0.0-win-x64.exe", "x64"],
    ["Pego-1.0.0.dmg", undefined],
  ])("%s", (name, arch) => expect(detectArch(name)).toBe(arch as never));
});

describe("groupReleaseAssets", () => {
  const grouped = groupReleaseAssets(v010?.assets ?? []);
  test("macOS: Apple silicon first, then Intel; no zip or blockmap", () => {
    expect(grouped.macos.map((o) => o.name)).toEqual([
      "Pego-0.1.0-beta-arm64.dmg",
      "Pego-0.1.0-beta-x64.dmg",
    ]);
  });
  test("Windows: exe only", () => {
    expect(grouped.windows.map((o) => o.name)).toEqual([
      "Pego-0.1.0-beta-win-x64.exe",
      "Pego-0.1.0-beta-win-arm64.exe",
    ]);
  });
  test("Windows portable zips are separate; macOS updater zips are ignored", () => {
    expect(grouped.windowsPortable.map((o) => o.name)).toEqual([
      "Pego-0.1.0-beta-win-x64.zip",
      "Pego-0.1.0-beta-win-arm64.zip",
    ]);
    expect(grouped.macos.some((o) => o.name.endsWith(".zip"))).toBe(false);
  });
  test("older naming (0.0.1-beta) still groups", () => {
    const old = groupReleaseAssets(v001?.assets ?? []);
    expect(old.macos).toHaveLength(2);
    expect(old.windows).toHaveLength(2);
    expect(old.windowsPortable).toHaveLength(0);
    expect(groupLinuxByFormat(old.linux).map((g) => g.format)).toEqual([
      "deb",
      "rpm",
      "AppImage",
      "pacman",
      "tar.gz",
    ]);
  });
  test("Linux: every format in order, with its arches", () => {
    expect(
      groupLinuxByFormat(grouped.linux).map((g) => [g.format, g.options.map((o) => o.arch)]),
    ).toEqual([
      ["deb", ["x64", "arm64"]],
      ["rpm", ["x64", "arm64"]],
      ["AppImage", ["x64", "arm64"]],
      ["pacman", ["x64", "arm64"]],
      ["tar.gz", ["x64", "arm64"]],
    ]);
  });
  test("checksums link, no yml", () => {
    expect(grouped.checksumsUrl).toEndWith("/SHA256SUMS.txt");
    const all = [...grouped.macos, ...grouped.windows, ...grouped.linux];
    expect(all.some((o) => o.name.endsWith(".yml"))).toBe(false);
  });
});

describe("labels", () => {
  test("size", () => {
    expect(formatSize(148_900_000)).toBe("142 MB");
    expect(formatSize(5_000_000)).toBe("4.8 MB");
    expect(formatSize(300)).toBe("1 KB");
  });
  test("accessible name", () => {
    const [arm] = groupReleaseAssets(v010?.assets ?? []).macos;
    expect(arm && downloadLabel(arm)).toBe("Download for macOS, Apple silicon, 142 MB");
  });
});

describe("pickDownloadTargets", () => {
  const entries = [
    { id: "newest", version: "0.1.0-beta" },
    { id: "older", version: "0.1.0-beta" },
    { id: "unversioned" },
  ];
  test("block sits on the newest entry of a released version only", () => {
    const { byEntry, latest } = pickDownloadTargets(entries, releases);
    expect([...byEntry.keys()]).toEqual(["newest"]);
    expect(latest?.version).toBe("0.1.0-beta");
  });
  test("a release without entries is never advertised", () => {
    const { byEntry, latest } = pickDownloadTargets([{ id: "a", version: "0.5.0" }], releases);
    expect(byEntry.size).toBe(0);
    expect(latest).toBeUndefined();
  });
  test("no releases, no UI", () => {
    expect(pickDownloadTargets(entries, []).latest).toBeUndefined();
  });
  test("a release with no installers is skipped", () => {
    const empty = releases.map((r) => ({ ...r, assets: [] }));
    expect(pickDownloadTargets(entries, empty).byEntry.size).toBe(0);
  });
});
