import { describe, expect, test } from "bun:test";
import { variablesSchema } from "@pego/doc";
import { contrastBetweenHex } from "../../../inspect/color";
import { findStyle } from "../../../styles/index";
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
