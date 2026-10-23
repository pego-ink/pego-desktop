import { describe, expect, test } from "bun:test";
import { variablesSchema } from "@pego/doc";
import { contrastBetweenHex } from "../../../inspect/color";
import { findStyle } from "../../../styles/index";
import { suggestStyle } from "../../select";
import { teenageEngineeringSkill as skill } from "./teenage-engineering";

const BLACK_EDITION = "Black edition tokens:";

/** The black edition swap, parsed from its one line in the skill: "name #HEX, name #HEX, ...". */
const blackEdition = (): Record<string, string> =>
  Object.fromEntries(
    (skill.content.split("\n").find((line) => line.startsWith(BLACK_EDITION)) ?? "")
      .slice(BLACK_EDITION.length)
      .split(",")
      .map((pair) => pair.trim().split(/\s+/) as [string, string])
      .filter(([name]) => name),
  );

describe("teenage-engineering style skill", () => {
  test("suggests only field-instrument and lists its two fonts", () => {
    expect(skill.styles).toEqual(["field-instrument"]);
    const { heading, body, mono } = findStyle("field-instrument")!.fonts;
    expect(heading).toBe(body);
    expect(skill.content.split("\n").filter((line) => line.startsWith("Fonts:"))).toEqual([
      `Fonts: ${heading}, ${mono}`,
    ]);
  });

  test("black edition swaps every color token and passes the preset contrast rules", () => {
    const dark = blackEdition();
    expect(dark).toEqual({
      bg: "#0F0E12",
      surface: "#272727",
      "surface-2": "#3B3B3D",
      border: "#4D4D4D",
      text: "#F5F5F5",
      "text-muted": "#B2B2B2",
      accent: "#F05A24",
      "on-accent": "#0F0E12",
      danger: "#FF7A6B",
    });
    const preset = findStyle("field-instrument")!;
    const colorKeys = Object.keys(preset.variables).filter(
      (name) => preset.variables[name]?.type === "color",
    );
    expect(Object.keys(dark).sort()).toEqual(colorKeys.sort());

    const ratio = (fg: string, bg: string) => contrastBetweenHex(dark[fg]!, dark[bg]!) ?? 0;
    for (const surface of ["bg", "surface", "surface-2"]) {
      expect([surface, ratio("text", surface) >= 7]).toEqual([surface, true]);
      expect([surface, ratio("text-muted", surface) >= 4.5]).toEqual([surface, true]);
    }
    expect(ratio("on-accent", "accent")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("accent", "surface")).toBeGreaterThanOrEqual(3);

    const swapped = {
      ...preset.variables,
      ...Object.fromEntries(
        Object.entries(dark).map(([name, value]) => [name, { type: "color", value }]),
      ),
    };
    expect(variablesSchema.safeParse(swapped).success).toBe(true);
  });

  test("is picked by its preset name and product names written without hyphens", () => {
    for (const prompt of [
      "dashboard in the Field Instrument style",
      "gaya field instrument",
      "kayak op1",
      "post instagram ala EP133",
      "TX6 mixer ui",
    ]) {
      expect([prompt, suggestStyle(prompt)?.id]).toEqual([prompt, "teenage-engineering"]);
    }
  });

  test("is not picked by component lists or car and cockpit dashboards", () => {
    for (const prompt of [
      "design system: buttons, input field, system alerts",
      "mobile app settings: name field, system theme toggle",
      "EV car dashboard with instrument panel and speedometer",
      "cockpit instrument panel for a flight sim",
    ]) {
      expect([prompt, suggestStyle(prompt)?.id]).not.toEqual([prompt, "teenage-engineering"]);
    }
  });

  test("black edition names the role of each token so dark keys stay dark", () => {
    const line = skill.content.split("\n").find((l) => l.startsWith("Black edition roles:")) ?? "";
    expect(line).toContain("keys $surface-2");
    expect(line).toContain("#000000 key shadow");
    expect(line).toContain("screens #0F0E12 with #F5F5F5 numbers");
    const dark = blackEdition();
    const ratio = (fg: string, bg: string) => contrastBetweenHex(fg, bg) ?? 0;
    // Keys on panels: labels and numbers stay readable, and the key is lighter than the body.
    expect(ratio(dark["text-muted"]!, dark["surface-2"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark.text!, dark["surface-2"]!)).toBeGreaterThanOrEqual(7);
    // The screen recipe names a number color that reads on the black screen in both editions.
    expect(skill.content).toMatch(/Screen:[^\n]*number #F5F5F5/);
  });

  test("katakana guidance only allows grounds where orange text passes contrast", () => {
    const light = findStyle("field-instrument")!.variables;
    const hex = (name: string) => light[name]?.value as string;
    const ratio = (fg: string, bg: string) => contrastBetweenHex(fg, bg) ?? 0;
    expect(skill.content).not.toContain("on dark or large");
    expect(skill.content).toContain("on black");
    expect(skill.content).toContain("large and only on $surface");
    expect(ratio(hex("accent"), "#0F0E12")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex("accent"), hex("surface"))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex("accent"), hex("bg"))).toBeLessThan(3);
  });

  test("names the Pego limits the dev-app check ran into", () => {
    // A ref cannot repaint its component root, so key variants live on an inner cap frame.
    expect(skill.content).toContain("inner cap frame");
    // check_layout warns when the sticker only partly overlaps the shape under it.
    expect(skill.content).toContain("fully inside the shape it sits on");
    // Variables are document-wide: a dark design beside light ones gets dark- variables.
    expect(skill.content).toContain("dark-bg");
  });

  test("has the mapping, the swap and the three recipes", () => {
    for (const part of [
      "## Hardware to UI",
      "## Black edition",
      "## In Pego",
      "- **Dashboard**:",
      "- **Landing page**:",
      "- **Social post**:",
    ]) {
      expect(skill.content).toContain(part);
    }
  });
});
