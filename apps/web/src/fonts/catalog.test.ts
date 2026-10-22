import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  buildFontFileUrl,
  buildPreviewCssUrl,
  compactFile,
  expandFile,
  resolveFile,
  type RawCatalog,
} from "./catalog";
import json from "./google-fonts.json";

const raw = json as unknown as RawCatalog;
const catalog = buildCatalog(raw);
const entryOf = (family: string) => {
  const entry = catalog.entries.get(family);
  if (!entry) throw new Error(`missing ${family}`);
  return entry;
};

describe("google-fonts.json", () => {
  test("has a pinned ref and every family with files", () => {
    expect(raw.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(raw.families.length).toBeGreaterThan(1500);
    for (const family of raw.families) expect(family[7].length).toBeGreaterThan(0);
  });

  test("entries have a valid shape with sorted weights", () => {
    for (const { info } of catalog.entries.values()) {
      expect(info.family.length).toBeGreaterThan(0);
      expect(raw.categories).toContain(info.category);
      expect(Number.isInteger(info.popularity)).toBe(true);
      for (const list of [info.weights.normal, info.weights.italic]) {
        expect(list).toEqual(list.toSorted((a, b) => a - b));
        for (const weight of list) expect(weight >= 100 && weight <= 1000).toBe(true);
      }
    }
  });

  test("contains Inter with the full weight range and an italic file", () => {
    const inter = entryOf("Inter");
    expect(inter.info.category).toBe("sans-serif");
    expect(inter.info.weights.normal).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(inter.variable).toBe(true);
    expect(resolveFile(inter, { family: "Inter", weight: 400, style: "italic" })?.italic).toBe(
      true,
    );
  });

  test("stays small", () => {
    expect(JSON.stringify(json).length).toBeLessThan(200 * 1024);
  });
});

describe("resolveFile", () => {
  test("variable family keeps the requested weight and style file", () => {
    const playfair = entryOf("Playfair Display");
    const file = resolveFile(playfair, {
      family: "Playfair Display",
      weight: 700,
      style: "italic",
    });
    expect(file).toEqual({
      file: "PlayfairDisplay-Italic[wght].ttf",
      weight: 700,
      italic: true,
      variable: true,
    });
  });

  test("static family picks the nearest weight", () => {
    const lobster = entryOf("Lobster");
    expect(resolveFile(lobster, { family: "Lobster", weight: 700, style: "normal" })?.file).toBe(
      "Lobster-Regular.ttf",
    );
    const roboto = buildCatalog({
      ref: "x",
      categories: ["sans-serif"],
      families: [
        [
          "Foo Bar",
          0,
          1,
          [400, 700],
          [],
          "",
          0,
          [
            [0, 400, "-Regular"],
            [0, 700, "-Bold"],
          ],
        ],
      ],
    });
    const foo = roboto.entries.get("Foo Bar");
    expect(foo && resolveFile(foo, { family: "Foo Bar", weight: 600, style: "normal" })?.file).toBe(
      "FooBar-Bold.ttf",
    );
  });

  test("falls back to the upright file when a family has no italic", () => {
    const lobster = entryOf("Lobster");
    expect(resolveFile(lobster, { family: "Lobster", weight: 400, style: "italic" })?.italic).toBe(
      false,
    );
  });
});

describe("file name compaction", () => {
  test("round-trips every catalog file", () => {
    for (const [family, , , , , , , faces] of raw.families) {
      for (const [, , compact] of faces) {
        expect(compactFile(family, expandFile(family, compact))).toBe(compact);
      }
    }
  });

  test("handles prefixed and unrelated names", () => {
    expect(compactFile("Open Sans", "OpenSans[wdth,wght].ttf")).toBe("[wdth,wght]");
    expect(compactFile("Lobster", "Lobster.ttf")).toBe("");
    expect(compactFile("Foo", "Bar-Regular.ttf")).toBe("Bar-Regular");
    expect(expandFile("Foo", "Bar-Regular")).toBe("Bar-Regular.ttf");
  });
});

describe("urls", () => {
  test("font file url is pinned to the commit and encodes brackets", () => {
    const url = buildFontFileUrl(catalog, entryOf("Playfair Display"), "PlayfairDisplay[wght].ttf");
    expect(url).toBe(
      `https://cdn.jsdelivr.net/gh/google/fonts@${raw.ref}/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`,
    );
  });

  test("css2 preview url batches families and limits text", () => {
    expect(
      buildPreviewCssUrl(["Playfair Display", "Space Grotesk"], "PlayfairDisplSpceGroteskx"),
    ).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display&family=Space+Grotesk&text=PlayfairDisplSpceGroteskx&display=swap",
    );
  });
});
