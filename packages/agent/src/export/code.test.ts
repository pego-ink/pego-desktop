import { describe, expect, test } from "bun:test";
import { exportCode } from "./code";
import { exportDoc } from "./test-docs";
import { setIconProvider } from "./icons";

const files = (format: "react-tailwind" | "html-css", id = "page") =>
  Object.fromEntries(exportCode(exportDoc, id, { format }).map((f) => [f.path, f.contents]));

describe("react-tailwind", () => {
  const out = files("react-tailwind");
  const page = out["components/Page.tsx"] ?? "";

  test("emits the page, the used component and a stylesheet", () => {
    expect(Object.keys(out).sort()).toEqual([
      "components/Button.tsx",
      "components/Page.tsx",
      "styles.css",
    ]);
  });

  test("maps flex layout, padding, gap variable and sizing", () => {
    expect(page).toContain(
      'className="flex flex-col justify-center items-start gap-(--gap) p-6 w-100 h-75 bg-[#ffffff]"',
    );
  });

  test("maps fill_container text and semantic tags", () => {
    expect(page).toContain("<h1");
    expect(page).toContain(
      "font-playfair-display text-[40px] font-bold leading-[normal] text-[#111111] whitespace-nowrap",
    );
    expect(page).toContain("<p className=");
    expect(page).toContain("self-stretch");
    // string variable is resolved into the text
    expect(page).toContain("Welcome");
  });

  test("simple instance becomes a component usage with text props", () => {
    expect(page).toContain('<Button label="Buy now" />');
    expect(page).toContain('import { Button } from "./Button";');
    const button = out["components/Button.tsx"] ?? "";
    expect(button).toContain(
      'export function Button({ label = "Click", className = "" }: ButtonProps)',
    );
    expect(button).toContain("{label}");
    expect(button).toContain('import { HeartIcon } from "lucide-react";');
    expect(button).toContain("<HeartIcon size={16}");
    expect(button).toContain("bg-accent");
    expect(button).toContain("rounded-lg");
  });

  test("instance without overrides is a plain usage; other overrides are expanded inline", () => {
    expect(page).toContain("<Button />");
    // cta-custom recolors the icon: expanded in place, not a Button usage
    expect(page.match(/<Button /g)?.length).toBe(2);
    expect(page).toContain("text-[#ff0000]");
  });

  test("absolute children, rotation, border and image", () => {
    expect(page).toContain(
      "absolute left-2.5 top-5 w-[50px] h-10 bg-[#ff8800] border-2 border-[#000000] rounded-sm",
    );
    expect(page).toContain("origin-top-left -rotate-45");
    expect(page).toContain("rounded-full");
    expect(page).toContain('src="https://example.com/a.png"');
    expect(page).toContain('alt="A photo"');
    expect(page).toContain("object-cover");
    expect(page).toContain('<path d="M0 0 L40 20"');
    expect(page).toContain('strokeWidth="2"');
  });

  test("css has @theme tokens and the google font import", () => {
    const css = out["styles.css"] ?? "";
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-accent: #0e7c5a;");
    expect(css).toContain("--gap: 12px;");
    expect(css).toContain('--font-playfair-display: "Playfair Display", serif;');
    expect(css).toContain("family=Inter:wght@400;600");
    expect(css).toContain("family=Playfair+Display:wght@700");
  });

  test("is deterministic", () => {
    expect(JSON.stringify(files("react-tailwind"))).toBe(JSON.stringify(out));
  });
});

describe("html-css", () => {
  const out = files("html-css");
  const html = out["index.html"] ?? "";
  const css = out["styles.css"] ?? "";

  test("repeats the component markup instead of components", () => {
    expect(Object.keys(out).sort()).toEqual(["index.html", "styles.css"]);
    expect(html.match(/Click/g)?.length).toBe(2);
    expect(html).toContain("Buy now");
  });

  test("links google fonts and the stylesheet", () => {
    expect(html).toContain(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=',
    );
    expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
  });

  test("uses custom properties and flex rules", () => {
    expect(css).toContain(":root {\n  --accent: #0e7c5a;\n  --gap: 12px;\n}");
    expect(css).toMatch(
      /\.page \{\n {2}display: flex;\n {2}flex-direction: column;\n {2}justify-content: center;\n {2}align-items: flex-start;\n {2}gap: var\(--gap\);\n {2}padding: 24px;\n {2}width: 400px;\n {2}height: 300px;\n {2}background-color: #ffffff;\n\}/,
    );
    expect(css).toContain("background-color: var(--accent);");
  });

  test("icons fall back to lucide's runtime without icon data, inline svg with it", () => {
    expect(html).toContain('<i data-lucide="heart"');
    setIconProvider((name) => (name === "heart" ? [["path", { d: "M1 1" }]] : undefined));
    try {
      const withIcons = exportCode(exportDoc, "page", { format: "html-css" }).find(
        (f) => f.path === "index.html",
      )?.contents;
      expect(withIcons).toContain('<svg xmlns="http://www.w3.org/2000/svg" class="heart"');
      expect(withIcons).toContain('<path d="M1 1" />');
      expect(withIcons).not.toContain("data-lucide");
    } finally {
      setIconProvider(undefined);
    }
  });
});

describe("edge cases", () => {
  test("unknown node throws", () => {
    expect(() => exportCode(exportDoc, "nope", { format: "html-css" })).toThrow("Unknown node");
  });

  test("a hugging absolute frame is sized from the layout when given", () => {
    const layout = new Map([["overlay", { x: 0, y: 0, width: 160, height: 60 }]]);
    const doc = {
      ...exportDoc,
      children: [
        {
          type: "frame" as const,
          id: "overlay",
          x: 0,
          y: 0,
          layout: "none" as const,
          fill: "#000000",
          children: [],
        },
      ],
    };
    const css = exportCode(doc, "overlay", { format: "html-css", layout }).find(
      (f) => f.path === "styles.css",
    )?.contents;
    expect(css).toContain("width: 160px;\n  height: 60px;");
  });

  test("a path with a 0x0 layout box is sized from its geometry", () => {
    const doc = {
      ...exportDoc,
      children: [
        {
          type: "path" as const,
          id: "star",
          x: 0,
          y: 0,
          geometry: "M0 0 L60 40 L10 80 Z",
          fill: "#ffffff",
        },
      ],
    };
    const layout = new Map([["star", { x: 0, y: 0, width: 0, height: 0 }]]);
    const tsx = exportCode(doc, "star", { format: "react-tailwind", layout }).find((f) =>
      f.path.endsWith(".tsx"),
    )?.contents;
    expect(tsx).toContain('viewBox="0 0 60 80"');
  });
});
