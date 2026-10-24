import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SVG_BYTES } from "@pego/agent";
import { FileToolError } from "./files";
import {
  listDesignSvgs,
  MAX_LISTED,
  MAX_READ_SVG_BYTES,
  readDesignSvg,
  resolveInsideDesignDir,
} from "./design-files";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
let base = "";
let design = "";
let outside = "";

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "pego-design-files-")));
  design = join(base, "design");
  outside = join(base, "outside");
  await mkdir(join(design, "logo", "pigeon"), { recursive: true });
  await mkdir(join(design, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(design, ".hidden"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(design, "root.svg"), SVG);
  await writeFile(join(design, "notes.txt"), "text");
  await writeFile(join(design, "logo", "mark.SVG"), SVG);
  await writeFile(join(design, "logo", "pigeon", "bird.svg"), SVG);
  await writeFile(join(design, "node_modules", "pkg", "skip.svg"), SVG);
  await writeFile(join(design, ".hidden", "skip.svg"), SVG);
  await writeFile(join(outside, "secret.svg"), "<svg>SECRET</svg>");
  await writeFile(join(base, "design-sibling.svg"), "<svg>SIBLING</svg>");
  await symlink(join(outside, "secret.svg"), join(design, "link.svg"));
  await symlink(outside, join(design, "linkdir"));
  await symlink(join(design, "logo"), join(design, "inner-link"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("resolveInsideDesignDir", () => {
  test("empty, dot and design/ resolve to the root", async () => {
    for (const input of ["", ".", "design", "design/", "./"]) {
      const resolved = await resolveInsideDesignDir(design, input);
      expect(resolved.abs).toBe(design);
      expect(resolved.rel).toBe("");
    }
  });

  test("strips a leading design/ segment and accepts relative paths", async () => {
    expect((await resolveInsideDesignDir(design, "design/logo/pigeon")).rel).toBe("logo/pigeon");
    expect((await resolveInsideDesignDir(design, "logo/pigeon")).rel).toBe("logo/pigeon");
  });

  test("accepts an absolute path inside the root", async () => {
    const resolved = await resolveInsideDesignDir(design, join(design, "logo"));
    expect(resolved.rel).toBe("logo");
  });

  test("rejects absolute paths outside the root", async () => {
    for (const input of [outside, join(outside, "secret.svg"), "/etc/passwd", "/"]) {
      expect(resolveInsideDesignDir(design, input)).rejects.toThrow(FileToolError);
    }
  });

  test("rejects a sibling folder that merely shares the root's prefix", async () => {
    expect(resolveInsideDesignDir(design, join(base, "design-sibling.svg"))).rejects.toThrow(
      FileToolError,
    );
  });

  test("rejects .. escapes, however they are written", async () => {
    for (const input of [
      "..",
      "../outside",
      "../outside/secret.svg",
      "logo/../../outside",
      "design/../outside",
      "design/../../outside/secret.svg",
      "logo/..\\..\\outside",
    ]) {
      expect(resolveInsideDesignDir(design, input)).rejects.toThrow(FileToolError);
    }
  });

  test("rejects a symlinked file, a symlinked folder and anything below a symlink", async () => {
    for (const input of [
      "link.svg",
      "linkdir",
      "linkdir/secret.svg",
      "inner-link",
      "inner-link/mark.SVG",
    ]) {
      expect(resolveInsideDesignDir(design, input)).rejects.toThrow(/link/);
    }
  });

  test("rejects NUL bytes and missing paths", async () => {
    expect(resolveInsideDesignDir(design, "root.svg\0.png")).rejects.toThrow(FileToolError);
    expect(resolveInsideDesignDir(design, "nope")).rejects.toThrow(/not found/i);
  });

  test("errors without a design folder", async () => {
    expect(resolveInsideDesignDir(null, "x")).rejects.toThrow(/no design folder/i);
    expect(resolveInsideDesignDir(join(base, "missing"), "x")).rejects.toThrow(/no design folder/i);
  });
});

describe("listDesignSvgs", () => {
  test("lists svg files and subfolders of the root, not recursive", async () => {
    const result = await listDesignSvgs(design, undefined, false);
    expect(result.path).toBe("");
    expect(result.files).toEqual([{ path: "root.svg", bytes: SVG.length }]);
    expect(result.folders).toEqual(["logo"]);
    expect(result.truncated).toBe(false);
  });

  test("lists a subfolder, with or without the design/ prefix", async () => {
    const a = await listDesignSvgs(design, "design/logo", false);
    const b = await listDesignSvgs(design, "logo", false);
    expect(a).toEqual(b);
    expect(a.files.map((file) => file.path)).toEqual(["logo/mark.SVG"]);
    expect(a.folders).toEqual(["logo/pigeon"]);
  });

  test("recursive skips dot folders, node_modules and symlinks", async () => {
    const result = await listDesignSvgs(design, ".", true);
    expect(result.files.map((file) => file.path)).toEqual([
      "logo/mark.SVG",
      "logo/pigeon/bird.svg",
      "root.svg",
    ]);
    expect(result.folders).toEqual([]);
  });

  test("never follows or lists symlinks", async () => {
    const result = await listDesignSvgs(design, "", true);
    const all = JSON.stringify(result);
    expect(all).not.toContain("secret");
    expect(all).not.toContain("link");
  });

  test("refuses escapes and files", async () => {
    expect(listDesignSvgs(design, "..", false)).rejects.toThrow(FileToolError);
    expect(listDesignSvgs(design, "linkdir", true)).rejects.toThrow(/link/);
    expect(listDesignSvgs(design, "root.svg", false)).rejects.toThrow(/not a folder/i);
  });

  test("caps the listing and says so", async () => {
    const many = join(design, "many");
    await mkdir(many);
    await Promise.all(
      Array.from({ length: MAX_LISTED + 5 }, (_, i) => writeFile(join(many, `f${i}.svg`), SVG)),
    );
    const result = await listDesignSvgs(design, "many", false);
    expect(result.files.length).toBe(MAX_LISTED);
    expect(result.truncated).toBe(true);
    await rm(many, { recursive: true });
  });
});

describe("readDesignSvg", () => {
  test("reads an svg by relative, prefixed or absolute path", async () => {
    const expected = { path: "logo/pigeon/bird.svg", bytes: SVG.length, svg: SVG };
    expect(await readDesignSvg(design, "logo/pigeon/bird.svg")).toEqual(expected);
    expect(await readDesignSvg(design, "design/logo/pigeon/bird.svg")).toEqual(expected);
    expect(await readDesignSvg(design, join(design, "logo", "pigeon", "bird.svg"))).toEqual(
      expected,
    );
    expect((await readDesignSvg(design, "logo/mark.SVG")).svg).toBe(SVG);
  });

  test("refuses escapes and symlinks without leaking content", async () => {
    for (const input of [
      "../outside/secret.svg",
      join(outside, "secret.svg"),
      "link.svg",
      "linkdir/secret.svg",
      "inner-link/mark.SVG",
    ]) {
      const error = await readDesignSvg(design, input).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(FileToolError);
      expect(String((error as Error).message)).not.toContain("SECRET");
    }
  });

  test("refuses non-svg files, folders and the root", async () => {
    expect(readDesignSvg(design, "notes.txt")).rejects.toThrow(/\.svg/);
    expect(readDesignSvg(design, "logo")).rejects.toThrow(/not a file/i);
    expect(readDesignSvg(design, "")).rejects.toThrow(FileToolError);
  });

  test("refuses files over the size cap", async () => {
    await writeFile(join(design, "big.svg"), `<svg>${"a".repeat(MAX_SVG_BYTES)}</svg>`);
    expect(readDesignSvg(design, "big.svg")).rejects.toThrow(/too large/);
  });

  test("the size cap matches insert_svg", () => {
    expect(MAX_READ_SVG_BYTES).toBe(MAX_SVG_BYTES);
  });

  test("errors without a design folder", async () => {
    expect(readDesignSvg(null, "root.svg")).rejects.toThrow(/no design folder/i);
  });
});
