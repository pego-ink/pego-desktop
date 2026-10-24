import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleRelease, mergeFeeds, sha256Sums } from "./assemble-release";

const feed = (arch: string, version = "0.1.0-nightly.20261024.5") =>
  [
    `version: ${version}`,
    "files:",
    `  - url: Pego-${version}-win-${arch}.exe`,
    `    sha512: sha-${arch}`,
    "    size: 123",
    `path: Pego-${version}-win-${arch}.exe`,
    `sha512: sha-${arch}`,
    "releaseDate: '2026-10-24T19:30:00.000Z'",
    "",
  ].join("\n");

describe("mergeFeeds", () => {
  test("unions the files of both arches and keeps the first feed's fields", () => {
    const merged = Bun.YAML.parse(
      mergeFeeds([
        { name: "x64", text: feed("x64") },
        { name: "arm64", text: feed("arm64") },
      ]),
    ) as { version: string; files: { url: string }[]; path: string; releaseDate: string };
    expect(merged.files.map((f) => f.url)).toEqual([
      "Pego-0.1.0-nightly.20261024.5-win-x64.exe",
      "Pego-0.1.0-nightly.20261024.5-win-arm64.exe",
    ]);
    expect(merged.path).toBe("Pego-0.1.0-nightly.20261024.5-win-x64.exe");
    expect(merged.releaseDate).toBe("2026-10-24T19:30:00.000Z");
    expect(mergeFeeds([{ name: "x64", text: feed("x64") }])).toContain(
      "releaseDate: '2026-10-24T19:30:00.000Z'",
    );
  });

  test("refuses mixed versions and junk", () => {
    expect(() =>
      mergeFeeds([
        { name: "a", text: feed("x64") },
        { name: "b", text: feed("arm64", "0.1.0-nightly.20261024.6") },
      ]),
    ).toThrow("differs");
    expect(() => mergeFeeds([{ name: "a", text: "hello: world" }])).toThrow("not an update feed");
    expect(() => mergeFeeds([])).toThrow();
  });
});

describe("sha256Sums", () => {
  test("is sorted and in sha256sum format", () => {
    const text = sha256Sums([
      { name: "b", data: new TextEncoder().encode("b") },
      { name: "a", data: new TextEncoder().encode("a") },
    ]);
    expect(text).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a\n" +
        "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b\n",
    );
  });
});

describe("assembleRelease", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("flattens artifacts, merges the shared feed, writes checksums", async () => {
    dir = await mkdtemp(join(tmpdir(), "assemble-"));
    const put = async (path: string, text: string) => {
      await mkdir(join(dir, "in", path, ".."), { recursive: true });
      await writeFile(join(dir, "in", path), text);
    };
    await put("windows-x64/Pego-1-win-x64.exe", "x64");
    await put("windows-x64/latest.yml", feed("x64", "1.0.0"));
    await put("windows-arm64/Pego-1-win-arm64.exe", "arm64");
    await put("windows-arm64/latest.yml", feed("arm64", "1.0.0"));
    await put("linux-x64/latest-linux.yml", feed("x64", "1.0.0"));
    await put("linux-x64/Pego-1-linux-x64.AppImage", "app");
    const names = await assembleRelease(join(dir, "in"), join(dir, "out"));
    expect((await readdir(join(dir, "out"))).sort()).toEqual(
      [
        "Pego-1-linux-x64.AppImage",
        "Pego-1-win-arm64.exe",
        "Pego-1-win-x64.exe",
        "SHA256SUMS.txt",
        "latest-linux.yml",
        "latest.yml",
      ].sort(),
    );
    expect(names).toContain("SHA256SUMS.txt");
    const merged = Bun.YAML.parse(await readFile(join(dir, "out", "latest.yml"), "utf8")) as {
      files: unknown[];
    };
    expect(merged.files).toHaveLength(2);
    const sums = await readFile(join(dir, "out", "SHA256SUMS.txt"), "utf8");
    expect(sums.trim().split("\n")).toHaveLength(5);
    expect(sums).not.toContain("SHA256SUMS.txt");
  });

  test("a binary name in two artifacts is an error", async () => {
    dir = await mkdtemp(join(tmpdir(), "assemble-"));
    for (const artifact of ["a", "b"]) {
      await mkdir(join(dir, "in", artifact), { recursive: true });
      await writeFile(join(dir, "in", artifact, "same.dmg"), artifact);
    }
    await expect(assembleRelease(join(dir, "in"), join(dir, "out"))).rejects.toThrow("more than");
  });
});
