/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { mentionToken } from "@pego/agent";
import { composerToPrompt, readMentionRef, textToComposer } from "./composer-doc";

const chip = (ref: unknown) => ({ type: "mention", attrs: { ref: JSON.stringify(ref) } });

describe("composer document → prompt", () => {
  test("text, chips and line breaks", () => {
    const prompt = composerToPrompt({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "make " },
            chip({ kind: "layer", ids: ["frame-1"] }),
            { type: "text", text: " dark" },
            { type: "hardBreak" },
            { type: "text", text: "in " },
            chip({ kind: "style", id: "bauhaus" }),
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "thanks" }] },
      ],
    });
    expect(prompt).toEqual({
      text: `make ${mentionToken(0)} dark\nin ${mentionToken(1)}\nthanks`,
      mentions: [
        { kind: "layer", ids: ["frame-1"] },
        { kind: "style", id: "bauhaus" },
      ],
    });
  });

  test("broken chip attributes are dropped", () => {
    expect(readMentionRef({ ref: "{not json" })).toBeNull();
    expect(readMentionRef({ ref: JSON.stringify({ kind: "page", id: "p" }) })).toBeNull();
    const prompt = composerToPrompt({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi " }, chip({ kind: "x" })] },
      ],
    });
    expect(prompt).toEqual({ text: "hi", mentions: [] });
  });

  test("plain text round-trips through the composer document", () => {
    const doc = textToComposer("first line\n\nthird");
    expect(composerToPrompt(doc)).toEqual({ text: "first line\n\nthird", mentions: [] });
  });
});
