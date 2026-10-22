import { describe, expect, test } from "bun:test";
import { toTailwind } from "./tailwind";

const cls = (...decls: [string, string][]) => toTailwind(decls).classes.join(" ");

describe("toTailwind", () => {
  test("orders classes canonically regardless of input order", () => {
    expect(cls(["color", "#fff"], ["display", "flex"], ["position", "absolute"])).toBe(
      "absolute flex text-[#fff]",
    );
  });

  test("spacing uses the scale when it lands on it, arbitrary values otherwise", () => {
    expect(cls(["gap", "16px"])).toBe("gap-4");
    expect(cls(["gap", "6px"])).toBe("gap-1.5");
    expect(cls(["gap", "13px"])).toBe("gap-[13px]");
    expect(cls(["left", "-8px"])).toBe("-left-2");
    expect(cls(["left", "0"])).toBe("left-0");
    expect(cls(["gap", "var(--space)"])).toBe("gap-(--space)");
  });

  test("padding shorthand expands", () => {
    expect(cls(["padding", "8px"])).toBe("p-2");
    expect(cls(["padding", "8px 16px"])).toBe("py-2 px-4");
    expect(cls(["padding", "1px 2px 3px 4px"])).toBe("pt-[1px] pr-0.5 pb-[3px] pl-1");
  });

  test("colors use theme tokens for variables and arbitrary values for hex", () => {
    expect(cls(["background-color", "var(--accent)"])).toBe("bg-accent");
    expect(cls(["background-color", "#0e7c5a80"])).toBe("bg-[#0e7c5a80]");
    expect(cls(["border", "2px solid var(--line)"])).toBe("border-2 border-line");
    expect(cls(["border", "1px solid #000"])).toBe("border border-[#000]");
  });

  test("radius, opacity and rotation", () => {
    expect(cls(["border-radius", "50%"])).toBe("rounded-full");
    expect(cls(["border-radius", "12px"])).toBe("rounded-xl");
    expect(cls(["border-radius", "14px"])).toBe("rounded-[14px]");
    expect(cls(["opacity", "0.4"])).toBe("opacity-40");
    expect(cls(["opacity", "0.333"])).toBe("opacity-[0.333]");
    expect(cls(["transform", "rotate(-30deg)"])).toBe("-rotate-30");
    expect(cls(["transform", "rotate(12.5deg)"])).toBe("rotate-[12.5deg]");
  });

  test("unmapped declarations fall back to an inline style", () => {
    const { classes, style } = toTailwind([["background-image", 'url("x.png")']]);
    expect(classes).toEqual([]);
    expect(style).toEqual([["background-image", 'url("x.png")']]);
  });

  test("duplicate properties keep the last value", () => {
    expect(cls(["width", "10px"], ["width", "100%"])).toBe("w-full");
  });
});
