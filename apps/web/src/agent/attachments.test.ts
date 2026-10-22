/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunAttachment } from "@pego/agent";
import {
  anthropicImageBlocks,
  anthropicUserContent,
  attachmentDataUrl,
  attachmentNote,
  findAttachmentSrc,
  nextAttachmentId,
  openAiImageParts,
} from "./attachments";

const att = (id: string, name = `${id}.png`): RunAttachment => ({
  id,
  name,
  mediaType: "image/png",
  data: "AAAA",
  width: 2,
  height: 2,
});

describe("nextAttachmentId", () => {
  test("starts at att-1 and goes one past the highest in use", () => {
    expect(nextAttachmentId([])).toBe("att-1");
    expect(nextAttachmentId([att("att-1")])).toBe("att-2");
    expect(nextAttachmentId([att("att-1"), att("att-4")])).toBe("att-5");
  });
  test("ignores ids that are not att-N", () => {
    expect(nextAttachmentId([att("custom")])).toBe("att-1");
  });
});

describe("payload builders", () => {
  test("data URL and anthropic image blocks", () => {
    expect(attachmentDataUrl(att("att-1"))).toBe("data:image/png;base64,AAAA");
    expect(anthropicImageBlocks([att("att-1")])).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  test("user content is a plain string without attachments, images first with them", () => {
    expect(anthropicUserContent("hi", [])).toBe("hi");
    const content = anthropicUserContent("make a hero", [att("att-1", "photo.png")]);
    if (typeof content === "string") throw new Error("expected blocks");
    expect(content.map((block) => block.type)).toEqual(["image", "text"]);
    const text = content[1];
    expect(text?.type === "text" && text.text).toContain('att-1 ("photo.png")');
    expect(text?.type === "text" && text.text).toEndWith("make a hero");
  });

  test("openai parts are image_url data URLs", () => {
    expect(openAiImageParts([att("att-1")])).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });

  test("note lists ids and names, empty without attachments", () => {
    expect(attachmentNote([])).toBe("");
    const note = attachmentNote([att("att-1", "a.png"), att("att-2", 'b "x".png')]);
    expect(note).toContain("2 images");
    expect(note).toContain('att-1 ("a.png"), att-2 ("b \\"x\\".png")');
    expect(note).toContain("attachment:<id>");
  });

  test("findAttachmentSrc resolves known ids only", () => {
    expect(findAttachmentSrc([att("att-1", "a.png")], "att-1")).toEqual({
      src: "data:image/png;base64,AAAA",
      name: "a.png",
    });
    expect(findAttachmentSrc([att("att-1")], "att-9")).toBeUndefined();
  });
});
