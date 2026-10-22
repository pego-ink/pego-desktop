import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import type { FontFamilyInfo } from "@/fonts/types";
import {
  buildRows,
  documentFamilies,
  hasItalicAt,
  nearestWeight,
  pushRecent,
  resolveFace,
  searchFamilies,
  stepActive,
  visibleRange,
  weightLabel,
} from "./font-utils";

const info = (
  family: string,
  popularity: number,
  normal: number[],
  italic: number[] = [],
  category: FontFamilyInfo["category"] = "sans-serif",
): FontFamilyInfo => ({ family, category, popularity, weights: { normal, italic } });

const catalog = [
  info("Roboto Mono", 3, [400], [], "monospace"),
  info("Roboto", 1, [100, 400, 700], [400, 700]),
  info("Open Sans", 2, [300, 400, 800], [400]),
  info("Playfair Display", 4, [400, 900], [400], "serif"),
  info("Dancing Script", 5, [400, 700], [], "handwriting"),
  info("Abel Roboto Like", 6, [400]),
];

describe("weightLabel", () => {
  test("names standard weights", () => {
    expect(weightLabel(600)).toBe("SemiBold 600");
    expect(weightLabel(200)).toBe("ExtraLight 200");
  });
  test("falls back to the number", () => {
    expect(weightLabel(450)).toBe("450");
  });
});

describe("nearestWeight", () => {
  test("exact match", () => expect(nearestWeight([300, 400, 700], 400)).toBe(400));
  test("nearest, ties go lighter", () => {
    expect(nearestWeight([300, 700], 500)).toBe(300);
    expect(nearestWeight([400, 700], 600)).toBe(700);
  });
  test("empty returns the target", () => expect(nearestWeight([], 500)).toBe(500));
});

describe("italic availability and resolveFace", () => {
  const roboto = catalog[1] as FontFamilyInfo;
  test("hasItalicAt", () => {
    expect(hasItalicAt(roboto, 700)).toBe(true);
    expect(hasItalicAt(roboto, 100)).toBe(false);
  });
  test("keeps weight and italic when available", () => {
    expect(resolveFace(roboto, 700, "italic")).toEqual({ weight: 700, style: "italic" });
  });
  test("snaps weight and keeps italic within the italic set", () => {
    expect(resolveFace(roboto, 100, "italic")).toEqual({ weight: 400, style: "italic" });
  });
  test("drops italic when the family has none", () => {
    const mono = catalog[0] as FontFamilyInfo;
    expect(resolveFace(mono, 700, "italic")).toEqual({ weight: 400, style: "normal" });
  });
});

describe("searchFamilies", () => {
  test("empty query sorts by popularity", () => {
    expect(searchFamilies(catalog, "", "all").map((f) => f.family)[0]).toBe("Roboto");
  });
  test("ranks prefix before word-start before substring", () => {
    const names = searchFamilies(catalog, "roboto", "all").map((f) => f.family);
    expect(names).toEqual(["Roboto", "Roboto Mono", "Abel Roboto Like"]);
  });
  test("matches word starts", () => {
    expect(searchFamilies(catalog, "sans", "all").map((f) => f.family)).toEqual(["Open Sans"]);
  });
  test("filters by category", () => {
    expect(searchFamilies(catalog, "", "serif").map((f) => f.family)).toEqual(["Playfair Display"]);
    expect(searchFamilies(catalog, "roboto", "monospace").map((f) => f.family)).toEqual([
      "Roboto Mono",
    ]);
  });
});

describe("pushRecent", () => {
  test("moves to front and dedupes", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });
  test("caps length", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("documentFamilies", () => {
  test("collects distinct text families, skipping variables", () => {
    const text = (id: string, fontFamily?: string) => ({
      id,
      type: "text" as const,
      content: "x",
      fontFamily,
    });
    const doc = {
      children: [
        { id: "f", type: "frame", layout: "none", children: [text("a", "Lora"), text("b", "$f")] },
        text("c", "Lora"),
        text("d", "Inter"),
      ],
    } as unknown as PegoDocument;
    expect(documentFamilies(doc)).toEqual(["Lora", "Inter"]);
  });
});

describe("buildRows and navigation", () => {
  const groups = { documentFamilies: ["Lora"], recent: ["Inter"], catalog: ["Roboto"] };
  test("groups with headers when browsing", () => {
    const rows = buildRows(groups, true);
    expect(rows.map((r) => (r.kind === "header" ? r.label : r.family))).toEqual([
      "In this document",
      "Lora",
      "Recent",
      "Inter",
      "All fonts",
      "Roboto",
    ]);
  });
  test("only results when searching", () => {
    expect(buildRows(groups, false).map((r) => r.kind)).toEqual(["header", "font"]);
  });
  test("stepActive skips headers and clamps", () => {
    const rows = buildRows(groups, true);
    expect(stepActive(rows, 1, 1)).toBe(3);
    expect(stepActive(rows, 3, -1)).toBe(1);
    expect(stepActive(rows, 1, -1)).toBe(1);
    expect(stepActive(rows, 5, 1)).toBe(5);
  });
});

describe("visibleRange", () => {
  test("windows with overscan, clamped", () => {
    expect(visibleRange(0, 280, 28, 1800, 4)).toEqual({ start: 0, end: 14 });
    expect(visibleRange(2800, 280, 28, 1800, 4)).toEqual({ start: 96, end: 114 });
    expect(visibleRange(0, 280, 28, 5, 4)).toEqual({ start: 0, end: 5 });
  });
});
