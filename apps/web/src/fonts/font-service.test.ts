import { beforeEach, describe, expect, mock, test } from "bun:test";

const registered: { bytes: ArrayBuffer; family: string }[] = [];
const fontProvider = {
  registerFont: (bytes: ArrayBuffer, family: string) => {
    registered.push({ bytes, family });
  },
};
mock.module("@/canvas/load-canvaskit", () => ({
  loadCanvasKit: async () => ({ fontProvider }),
}));

const { ensureFontFace, findFontFamily, fontVariationsFor, loadFontCatalog } =
  await import("./font-service");
const { useFontEvents } = await import("./font-events");

const sfnt = () => new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]).buffer;
let fetched: string[] = [];
let respond: (url: string) => Response = () => new Response(sfnt());

beforeEach(() => {
  registered.length = 0;
  fetched = [];
  respond = () => new Response(sfnt());
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    await Promise.resolve();
    return respond(url);
  }) as typeof fetch;
});

describe("font service", () => {
  test("loads the catalog lazily and finds families", async () => {
    expect(findFontFamily("Inter")).toBeUndefined();
    const families = await loadFontCatalog();
    expect(families.find((f) => f.family === "Inter")).toBeDefined();
    expect(findFontFamily("Inter")?.weights.normal).toContain(700);
    expect(findFontFamily("Nope Not A Font")).toBeUndefined();
  });

  test("dedupes concurrent and repeated loads of one file", async () => {
    await loadFontCatalog();
    const before = useFontEvents.getState().version;
    const face = { family: "Playfair Display", weight: 700, style: "italic" } as const;
    const results = await Promise.all([
      ensureFontFace(face),
      ensureFontFace(face),
      ensureFontFace({ ...face, weight: 500 }),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(await ensureFontFace(face)).toBe(true);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain("PlayfairDisplay-Italic%5Bwght%5D.ttf");
    expect(registered).toHaveLength(1);
    expect(registered[0]?.family).toBe("Playfair Display");
    expect(useFontEvents.getState().version).toBe(before + 1);
  });

  test("the bundled Inter upright face needs no download", async () => {
    expect(await ensureFontFace({ family: "Inter", weight: 400, style: "normal" })).toBe(true);
    expect(fetched).toHaveLength(0);
  });

  test("unknown families resolve false without fetching", async () => {
    expect(await ensureFontFace({ family: "Nope Not A Font", weight: 400, style: "normal" })).toBe(
      false,
    );
    expect(fetched).toHaveLength(0);
  });

  test("http errors, network errors and non-font payloads resolve false, then can retry", async () => {
    const face = { family: "Lobster", weight: 400, style: "normal" } as const;
    respond = () => new Response("nope", { status: 404 });
    expect(await ensureFontFace(face)).toBe(false);
    respond = () => new Response("<html>not a font at all</html>");
    expect(await ensureFontFace(face)).toBe(false);
    respond = () => {
      throw new Error("offline");
    };
    expect(await ensureFontFace(face)).toBe(false);
    expect(registered).toHaveLength(0);
    respond = () => new Response(sfnt());
    expect(await ensureFontFace(face)).toBe(true);
    expect(registered).toHaveLength(1);
  });

  test("variable families expose a wght variation, static ones do not", async () => {
    await loadFontCatalog();
    expect(fontVariationsFor({ family: "Inter", weight: 600, style: "normal" })).toEqual([
      { axis: "wght", value: 600 },
    ]);
    expect(fontVariationsFor({ family: "Lobster", weight: 400, style: "normal" })).toBeUndefined();
  });
});
