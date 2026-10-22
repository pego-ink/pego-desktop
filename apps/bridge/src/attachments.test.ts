import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageBytes, makeAttachment } from "./agents/fixtures/images";
import {
  attachmentPromptNote,
  hasImageSignature,
  sanitizeAttachmentName,
  withAtFileReferences,
  writeAttachments,
} from "./attachments";

const dirs: string[] = [];
const workdir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pego-att-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeAttachments", () => {
  test("writes attachments/<id>.<ext> from the media type, owner-only", async () => {
    const dir = await workdir();
    const written = await writeAttachments(dir, [
      makeAttachment("att-1", "image/png"),
      makeAttachment("att-2", "image/jpeg"),
      makeAttachment("att-3", "image/webp"),
      makeAttachment("att-4", "image/gif"),
    ]);
    expect(written.map((item) => item.relativePath)).toEqual([
      "attachments/att-1.png",
      "attachments/att-2.jpg",
      "attachments/att-3.webp",
      "attachments/att-4.gif",
    ]);
    expect((await readdir(join(dir, "attachments"))).sort()).toEqual([
      "att-1.png",
      "att-2.jpg",
      "att-3.webp",
      "att-4.gif",
    ]);
    const first = written[0];
    expect(first?.path).toBe(join(dir, "attachments", "att-1.png"));
    expect(await readFile(join(dir, "attachments", "att-1.png"))).toEqual(
      Buffer.from(makeAttachment().data, "base64"),
    );
    expect((await stat(join(dir, "attachments", "att-1.png"))).mode & 0o077).toBe(0);
  });

  test("the display name never reaches the path", async () => {
    const dir = await workdir();
    const written = await writeAttachments(dir, [
      makeAttachment("att-1", "image/png", { name: "../../../etc/passwd" }),
      makeAttachment("att-2", "image/png", { name: "/abs/evil.sh" }),
    ]);
    expect(written.every((item) => item.path.startsWith(join(dir, "attachments") + "/"))).toBe(
      true,
    );
    expect(await readdir(dir)).toEqual(["attachments"]);
    expect((await readdir(join(dir, "attachments"))).sort()).toEqual(["att-1.png", "att-2.png"]);
  });

  test("ids that are not att-<n> are refused before anything is written", async () => {
    const dir = await workdir();
    for (const id of ["../x", "att-1/../../x", "x", "att-"]) {
      await expect(writeAttachments(dir, [makeAttachment(id)])).rejects.toThrow(
        "invalid attachment id",
      );
    }
    expect(await readdir(dir)).toEqual([]);
  });

  test("never overwrites or follows a pre-existing file or symlink", async () => {
    const dir = await workdir();
    const outside = join(await workdir(), "target.txt");
    await writeFile(outside, "original");
    await mkdir(join(dir, "attachments"));
    await symlink(outside, join(dir, "attachments", "att-1.png"));
    await expect(writeAttachments(dir, [makeAttachment("att-1")])).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("original");
  });

  test("no attachments: nothing is created", async () => {
    const dir = await workdir();
    expect(await writeAttachments(dir, [])).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("sanitizeAttachmentName", () => {
  test("keeps the last path segment, drops controls and reference characters", () => {
    expect(sanitizeAttachmentName("a/b\\c/photo 1.png")).toBe("photo 1.png");
    expect(sanitizeAttachmentName("@file `rm -rf`$(x).png")).toBe("file rm -rfx.png");
    expect(sanitizeAttachmentName("tab\there.png")).toBe("tabhere.png");
    expect(sanitizeAttachmentName("   ")).toBe("image");
    expect(sanitizeAttachmentName(".hidden")).toBe("hidden");
    expect(sanitizeAttachmentName("x".repeat(500)).length).toBe(80);
  });
});

describe("hasImageSignature", () => {
  test("matches each type and nothing else", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"] as const) {
      expect(hasImageSignature(type, imageBytes(type, 8).toString("base64"))).toBe(true);
    }
    expect(hasImageSignature("image/png", imageBytes("image/gif", 8).toString("base64"))).toBe(
      false,
    );
    expect(hasImageSignature("image/webp", imageBytes("image/png", 8).toString("base64"))).toBe(
      false,
    );
  });
});

describe("prompt helpers", () => {
  const items = [
    {
      ...makeAttachment("att-1"),
      path: "/w/attachments/att-1.png",
      relativePath: "attachments/att-1.png",
    },
    {
      ...makeAttachment("att-2", "image/jpeg", { name: "b.jpg" }),
      path: "/w/attachments/att-2.jpg",
      relativePath: "attachments/att-2.jpg",
    },
  ];
  test("the note lists ids and how to place them", () => {
    expect(attachmentPromptNote([])).toBe("");
    const note = attachmentPromptNote(items);
    expect(note).toContain("att-1 (ref.png), att-2 (b.jpg)");
    expect(note).toContain('place_image with src "attachment:<id>"');
  });
  test("@file references are relative to the workdir", () => {
    expect(withAtFileReferences("hi", [])).toBe("hi");
    expect(withAtFileReferences("hi", items)).toBe(
      "hi\n\n@attachments/att-1.png @attachments/att-2.jpg",
    );
  });
});
