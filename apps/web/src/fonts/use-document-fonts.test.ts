import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import { collectFontFaces, requestNewFaces } from "./use-document-fonts";

const text = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  content: "hi",
  ...extra,
});

const doc = {
  version: 1,
  variables: { w: { type: "number", value: 700 } },
  children: [
    text("a", { fontFamily: "Inter", fontWeight: 700 }),
    text("b", { fontFamily: "Lora" }),
    text("c", { fontFamily: "Lora", fontWeight: 400 }),
    text("d", { fontFamily: "Lora", fontWeight: "$w", fontStyle: "italic" }),
    {
      id: "comp",
      type: "frame",
      reusable: true,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      layout: "none",
      children: [text("label", { fontFamily: "Roboto", fontWeight: 300 })],
    },
    {
      id: "inst",
      type: "ref",
      ref: "comp",
      x: 0,
      y: 0,
      descendants: { label: { fontFamily: "Playfair Display", fontWeight: 900 } },
    },
  ],
} as unknown as PegoDocument;

describe("collectFontFaces", () => {
  const faces = collectFontFaces(doc);
  const has = (family: string, weight: number, style: string) =>
    faces.some((f) => f.family === family && f.weight === weight && f.style === style);

  test("skips Inter and dedupes", () => {
    expect(faces.some((f) => f.family === "Inter")).toBe(false);
    expect(faces.filter((f) => f.family === "Lora" && f.weight === 400)).toHaveLength(1);
  });
  test("resolves variables and italic", () => {
    expect(has("Lora", 700, "italic")).toBe(true);
  });
  test("includes component sources and instance overrides", () => {
    expect(has("Roboto", 300, "normal")).toBe(true);
    expect(has("Playfair Display", 900, "normal")).toBe(true);
  });
});

describe("requestNewFaces", () => {
  test("requests each face once", () => {
    const seen = new Set<string>();
    const calls: string[] = [];
    const ensure = async (f: { family: string }) => {
      calls.push(f.family);
      return true;
    };
    const f = { family: "Lora", weight: 400, style: "normal" as const };
    requestNewFaces([f, f], ensure, seen);
    requestNewFaces([f], ensure, seen);
    expect(calls).toEqual(["Lora"]);
  });
});
