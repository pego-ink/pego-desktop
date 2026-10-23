/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import type { MentionRef } from "@pego/agent";
import { composerToPrompt, type ComposerNode } from "./composer-doc";
import { createMentionExtension } from "./mention-extension";
import { liveChipTransaction, type LiveChip } from "./live-chips";

const schema = getSchema([
  StarterKit,
  createMentionExtension(() => ({ items: () => [], onChange: () => {}, onKeyDown: () => false })),
]);

const stateOf = (content: ComposerNode[]) =>
  EditorState.create({
    schema,
    doc: Node.fromJSON(schema, { type: "doc", content: [{ type: "paragraph", content }] }),
  });

const chip = (ids: string[]): LiveChip => ({ ref: { kind: "layer", ids }, label: ids.join("+") });

const mention = (ref: MentionRef, live: string | null = null): ComposerNode => ({
  type: "mention",
  attrs: { ref: JSON.stringify(ref), label: "x", live },
});

/** Apply the live sync to `state`; the state is unchanged when there was nothing to do. */
const sync = (state: EditorState, chips: LiveChip[]) => {
  const tr = liveChipTransaction(state, "selection", chips);
  return { tr, state: tr ? state.apply(tr) : state };
};

const lastParagraph = (state: EditorState) =>
  (state.doc.toJSON() as { content: { content?: ComposerNode[] }[] }).content.at(-1)?.content ?? [];

describe("live selection chip", () => {
  test("the prompt ends with the selection; same selection again changes nothing", () => {
    const first = sync(stateOf([{ type: "text", text: "make " }]), [chip(["a"])]);
    expect(first.tr?.getMeta("addToHistory")).toBe(false);
    expect(composerToPrompt(first.state.doc.toJSON() as ComposerNode).mentions).toEqual([
      { kind: "layer", ids: ["a"] },
    ]);
    expect(sync(first.state, [chip(["a"])]).tr).toBeNull();
  });

  test("a new selection replaces the trailing live chip; none removes it", () => {
    const start = stateOf([{ type: "text", text: "make " }, mention(chip(["a"]).ref, "selection")]);
    const next = sync(start, [chip(["b", "c"])]).state;
    expect(lastParagraph(next).map((node) => node.attrs?.ref ?? node.text)).toEqual([
      "make ",
      JSON.stringify({ kind: "layer", ids: ["b", "c"] }),
    ]);
    expect(lastParagraph(sync(next, []).state)).toEqual([{ type: "text", text: "make " }]);
  });

  test("text typed after a live chip keeps it; the next selection is added at the end", () => {
    const start = stateOf([
      mention(chip(["a"]).ref, "selection"),
      { type: "text", text: " bigger" },
    ]);
    const next = sync(start, [chip(["b"])]).state;
    expect(composerToPrompt(next.doc.toJSON() as ComposerNode).mentions).toEqual([
      { kind: "layer", ids: ["a"] },
      { kind: "layer", ids: ["b"] },
    ]);
  });

  test("a chip picked from the @ menu is never replaced", () => {
    const start = stateOf([mention({ kind: "layer", ids: ["a"] })]);
    const next = sync(start, [chip(["b"])]).state;
    expect(composerToPrompt(next.doc.toJSON() as ComposerNode).mentions).toHaveLength(2);
    expect(composerToPrompt(sync(next, []).state.doc.toJSON() as ComposerNode).mentions).toEqual([
      { kind: "layer", ids: ["a"] },
    ]);
  });

  test("selection and browser chips at the end keep their places", () => {
    const element: LiveChip = {
      ref: { kind: "browser", selector: "#cta", label: "a" },
      label: "a",
    };
    let state = sync(stateOf([{ type: "text", text: "match " }]), [chip(["a"])]).state;
    const browser = liveChipTransaction(state, "browser", [element]);
    state = state.apply(browser!);
    state = sync(state, [chip(["b"])]).state;
    expect(composerToPrompt(state.doc.toJSON() as ComposerNode).mentions).toEqual([
      { kind: "layer", ids: ["b"] },
      { kind: "browser", selector: "#cta", label: "a" },
    ]);
    state = state.apply(liveChipTransaction(state, "browser", [])!);
    expect(composerToPrompt(state.doc.toJSON() as ComposerNode).mentions).toEqual([
      { kind: "layer", ids: ["b"] },
    ]);
  });
});
