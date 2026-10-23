/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createMentionExtension } from "./mention-extension";

const schema = getSchema([
  StarterKit,
  createMentionExtension(() => ({ items: () => [], onChange: () => {}, onKeyDown: () => false })),
]);
const type = schema.nodes.mention;

/** The chip as copy/paste sees it: toDOM output read back through the parse rule. */
const roundTrip = (attrs: Record<string, unknown>) => {
  if (!type) throw new Error("no mention node");
  const spec = type.spec.toDOM?.(type.create(attrs)) as [string, Record<string, string>, string];
  const dom = { getAttribute: (name: string) => spec[1][name] ?? null };
  const rule = type.spec.parseDOM?.find((candidate) => candidate.tag?.includes("mention"));
  const parsed = rule?.getAttrs?.(dom as unknown as HTMLElement);
  return { spec, parsed };
};

describe("mention chip html", () => {
  test("ref, label and live survive a copy/paste round trip", () => {
    const ref = JSON.stringify({ kind: "layer", ids: ["a", "b"] });
    const { spec, parsed } = roundTrip({ ref, label: "Hero", live: "selection" });
    expect(spec[2]).toBe("@Hero");
    expect(parsed).toMatchObject({ ref, label: "Hero", live: "selection" });
  });

  test("a fixed chip stays fixed", () => {
    const ref = JSON.stringify({ kind: "component", id: "card" });
    const { parsed } = roundTrip({ ref, label: "Card" });
    expect(parsed).toMatchObject({ ref, label: "Card" });
    expect((parsed as { live?: string | null }).live ?? null).toBeNull();
  });
});
