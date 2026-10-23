import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { variablesSchema } from "@pego/doc";
import { contrastBetweenHex } from "../inspect/color";
import { agentTools } from "../tools";
import { findStyle, stylePresets } from "./index";

const EXPECTED_IDS = [
  "quiet-ink",
  "warm-editorial",
  "midnight-product",
  "terminal-green",
  "soft-bento",
  "bold-block",
  "forest-sage",
  "carbon-dense",
  "swiss-grid",
  "newsprint",
  "studio-minimal",
  "warm-craft",
  "clinical-light",
  "data-dense-dark",
  "playful-rounded",
  "architectural",
  "botanical",
  "nordic-calm",
  "high-contrast-mono",
  "sunlit-pastel",
  "field-instrument",
];

/** Google Fonts catalog: families are tuples of [name, _, _, weights, ...]. */
const catalog = (() => {
  const url = new URL("../../../../apps/web/src/fonts/google-fonts.json", import.meta.url);
  const json = JSON.parse(readFileSync(url, "utf8")) as {
    families: [string, number, number, number[]][];
  };
  return new Map(json.families.map((family) => [family[0], family[3]]));
})();

const hex = (style: (typeof stylePresets)[number], name: string) =>
  style.variables[name]?.value as string;

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** sRGB hex to OKLab. */
const oklab = (value: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(value.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const deltaE = (a: string, b: string) => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe("style presets", () => {
  test("exactly the expected ids, unique, findable", () => {
    expect(stylePresets.map((s) => s.name)).toEqual(EXPECTED_IDS);
    expect(new Set(stylePresets.map((s) => s.name)).size).toBe(EXPECTED_IDS.length);
    for (const id of EXPECTED_IDS) expect(findStyle(id)?.name).toBe(id);
  });

  test("field-instrument carries the official TE palette and the agreed fonts", () => {
    const style = findStyle("field-instrument")!;
    const v = (name: string) => style.variables[name]?.value;
    expect(style.title).toBe("Field Instrument");
    expect(style.fonts).toEqual({ heading: "Noto Sans JP", body: "Noto Sans JP", mono: "Doto" });
    expect(style.weights).toEqual({ heading: [200, 300], body: [300, 400, 500], mono: [700, 900] });
    expect(style.typeScale).toEqual({
      caption: 11,
      body: 15,
      lead: 18,
      h3: 22,
      h2: 32,
      h1: 48,
      display: 88,
    });
    expect(
      [
        "bg",
        "surface",
        "surface-2",
        "border",
        "text",
        "text-muted",
        "accent",
        "on-accent",
        "danger",
      ].map(v),
    ).toEqual([
      "#F0F0EF",
      "#F5F5F5",
      "#E5E5E5",
      "#CCCCCC",
      "#0F0E12",
      "#4D4D4D",
      "#F05A24",
      "#0F0E12",
      "#B81D13",
    ]);
    expect(["radius-sm", "radius-md", "radius-lg"].map(v)).toEqual([4, 6, 12]);
    expect(["space-xs", "space-sm", "space-md", "space-lg", "space-xl"].map(v)).toEqual([
      4, 8, 12, 24, 48,
    ]);
    // Keys at a panel corner stay concentric for the ui-polish check.
    expect((v("radius-sm") as number) + (v("space-sm") as number)).toBe(v("radius-lg") as number);
    expect(findStyle("Field Instrument")?.name).toBe("field-instrument");
  });

  test("field-instrument gives panels with corner keys the padding that keeps corners nested", () => {
    const { density, corners } = findStyle("field-instrument")!.layout;
    expect(density).toContain("8px padding on panels with keys at their corners");
    expect(density).not.toContain("12-24px panel padding");
    expect(corners).toContain("8 padding");
  });

  test("variables parse and share the same token names", () => {
    const keys = Object.keys(stylePresets[0]!.variables).sort();
    for (const style of stylePresets) {
      expect(variablesSchema.safeParse(style.variables).success).toBe(true);
      expect(Object.keys(style.variables).sort()).toEqual(keys);
    }
    for (const required of [
      "bg",
      "surface",
      "surface-2",
      "border",
      "text",
      "text-muted",
      "accent",
      "on-accent",
      "danger",
      "radius-sm",
      "radius-md",
      "radius-lg",
      "space-xs",
      "space-sm",
      "space-md",
      "space-lg",
      "space-xl",
    ]) {
      expect(keys).toContain(required);
    }
  });

  test("WCAG contrast", () => {
    for (const style of stylePresets) {
      const ratio = (fg: string, bg: string) =>
        contrastBetweenHex(hex(style, fg), hex(style, bg)) ?? 0;
      for (const surface of ["bg", "surface", "surface-2"]) {
        expect([style.name, surface, ratio("text", surface) >= 7]).toEqual([
          style.name,
          surface,
          true,
        ]);
        expect([style.name, surface, ratio("text-muted", surface) >= 4.5]).toEqual([
          style.name,
          surface,
          true,
        ]);
      }
      expect([style.name, ratio("on-accent", "accent") >= 4.5]).toEqual([style.name, true]);
      expect([style.name, ratio("accent", "surface") >= 3]).toEqual([style.name, true]);
    }
  });

  test("fonts exist in the Google Fonts catalog with the declared weights", () => {
    for (const style of stylePresets) {
      for (const role of ["heading", "body", "mono"] as const) {
        const family = style.fonts[role];
        const available = catalog.get(family);
        expect([style.name, family, available !== undefined]).toEqual([style.name, family, true]);
        for (const weight of style.weights[role]) {
          expect([style.name, family, weight, available?.includes(weight)]).toEqual([
            style.name,
            family,
            weight,
            true,
          ]);
        }
      }
    }
  });

  test("accents are pairwise distinct (OKLab distance)", () => {
    const MIN = 0.08;
    const tooClose: string[] = [];
    for (const [i, a] of stylePresets.entries()) {
      for (const b of stylePresets.slice(i + 1)) {
        const distance = deltaE(hex(a, "accent"), hex(b, "accent"));
        if (distance < MIN) tooClose.push(`${a.name}/${b.name} ${distance.toFixed(3)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  test("each preset is described and has actionable notes", () => {
    for (const style of stylePresets) {
      expect(style.mood.length).toBeGreaterThan(20);
      expect(style.bestFor.length).toBeGreaterThan(10);
      expect(style.dos.length).toBeGreaterThanOrEqual(3);
      expect(style.donts.length).toBeGreaterThanOrEqual(2);
      for (const value of Object.values(style.layout)) expect(value.length).toBeGreaterThan(10);
    }
  });

  test("get_style returns set_variables-ready output for every preset", async () => {
    const getStyle = agentTools.find((t) => t.name === "get_style");
    expect(getStyle).toBeDefined();
    for (const style of stylePresets) {
      const result = await getStyle!.run({ name: style.name }, {} as never);
      expect(result.isError).toBe(false);
      const body = JSON.parse(result.content);
      expect(variablesSchema.safeParse(body.variables).success).toBe(true);
      expect(body.layout).toBeDefined();
      expect(body.weights).toBeDefined();
    }
  });
});
