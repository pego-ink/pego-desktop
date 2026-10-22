/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { steerBlocks } from "./api-runtime";
import { steerMessage } from "./providers/openai-runtime";
import { createSteerInbox, steerImages, steerText, type SteerMessage } from "./steer-inbox";

const msg = (id: string, text: string, withImage = false): SteerMessage => ({
  id,
  text,
  attachments: withImage
    ? [{ id: "att-2", name: "ref.png", mediaType: "image/png", data: "AAAA" }]
    : [],
});

describe("steer inbox", () => {
  test("drain returns pending messages once, oldest first, and reports each as delivered", () => {
    const delivered: string[] = [];
    const inbox = createSteerInbox((m) => delivered.push(m.id));
    inbox.push(msg("a", "one"));
    inbox.push(msg("b", "two"));
    expect(inbox.pending()).toBe(2);
    expect(inbox.drain().map((m) => m.id)).toEqual(["a", "b"]);
    expect(inbox.drain()).toEqual([]);
    expect(delivered).toEqual(["a", "b"]);
    expect(inbox.pending()).toBe(0);
  });

  test("delivered messages stay available for later steps", () => {
    const inbox = createSteerInbox();
    inbox.push(msg("a", "one"));
    inbox.drain();
    inbox.push(msg("b", "two"));
    expect(inbox.delivered().map((m) => m.id)).toEqual(["a"]);
    inbox.drain();
    expect(inbox.delivered().map((m) => m.id)).toEqual(["a", "b"]);
  });

  test("takePending hands messages back without delivering them", () => {
    const delivered: string[] = [];
    const inbox = createSteerInbox((m) => delivered.push(m.id));
    inbox.push(msg("a", "one"));
    expect(inbox.takePending().map((m) => m.id)).toEqual(["a"]);
    expect(inbox.drain()).toEqual([]);
    expect(delivered).toEqual([]);
  });
});

describe("steer content", () => {
  test("text carries every message; image notes name the images", () => {
    const text = steerText([msg("a", "go left", true), msg("b", "bigger")]);
    expect(text).toContain("go left");
    expect(text).toContain("bigger");
    expect(text).toContain("att-2");
    expect(steerImages([msg("a", "x", true), msg("b", "y")])).toHaveLength(1);
  });

  test("Anthropic blocks: none without messages, images before text otherwise", () => {
    expect(steerBlocks([])).toEqual([]);
    const blocks = steerBlocks([msg("a", "go left", true)]);
    expect(blocks.map((b) => b.type)).toEqual(["image", "text"]);
  });

  test("OpenAI message: plain text, or parts with images unless the provider refuses them", () => {
    expect(typeof steerMessage([msg("a", "go left")]).content).toBe("string");
    const withImage = steerMessage([msg("a", "go left", true)]);
    expect(Array.isArray(withImage.content)).toBe(true);
    expect(typeof steerMessage([msg("a", "go left", true)], false).content).toBe("string");
  });
});
