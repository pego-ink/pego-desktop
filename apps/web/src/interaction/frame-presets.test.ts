import { describe, expect, test } from "bun:test";
import {
  FRAME_PRESET_CATEGORIES,
  findFramePreset,
  freeFrameSpot,
  matchFramePreset,
  searchFramePresets,
  swapOrientation,
} from "./frame-presets";

const all = FRAME_PRESET_CATEGORIES.flatMap((c) => c.presets);

describe("preset data", () => {
  test("ids are unique and sizes are positive whole numbers", () => {
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    for (const preset of all) {
      expect(Number.isInteger(preset.width) && preset.width > 0).toBe(true);
      expect(Number.isInteger(preset.height) && preset.height > 0).toBe(true);
    }
  });

  test("every category cites a source url", () => {
    for (const category of FRAME_PRESET_CATEGORIES) {
      expect(category.source).toMatch(/^https?:\/\//);
    }
  });

  test("key sizes", () => {
    expect(findFramePreset("instagram-story")).toMatchObject({ width: 1080, height: 1920 });
    expect(findFramePreset("instagram-post-portrait")).toMatchObject({ width: 1080, height: 1350 });
    expect(findFramePreset("a4")).toMatchObject({ width: 595, height: 842 });
    expect(findFramePreset("nope")).toBeUndefined();
  });
});

describe("searchFramePresets", () => {
  test("blank query returns everything", () => {
    expect(searchFramePresets("  ")).toHaveLength(FRAME_PRESET_CATEGORIES.length);
  });

  test("matches names, Indonesian aliases and sizes", () => {
    const ids = (q: string) => searchFramePresets(q).flatMap((c) => c.presets.map((x) => x.id));
    expect(ids("story")).toContain("instagram-story");
    expect(ids("story ig")).toContain("instagram-story");
    expect(ids("kartu nama")).toEqual(["business-card"]);
    expect(ids("poster")).toContain("poster-18-24");
    expect(ids("1080x1350")).toEqual(["instagram-post-portrait"]);
    expect(ids("zzzz")).toEqual([]);
  });

  test("drops categories without matches", () => {
    expect(searchFramePresets("watch").map((c) => c.id)).toEqual(["watch"]);
  });
});

describe("matchFramePreset / swapOrientation", () => {
  test("matches either orientation", () => {
    expect(matchFramePreset(1080, 1920)?.id).toBe("instagram-story");
    expect(matchFramePreset(1920, 1080)?.id).toBe("desktop-hd");
    expect(matchFramePreset(1350, 1080)?.id).toBe("instagram-post-portrait");
    expect(matchFramePreset(7, 9)).toBeUndefined();
  });

  test("swaps width and height", () => {
    expect(swapOrientation({ width: 10, height: 20 })).toEqual({ width: 20, height: 10 });
  });
});

describe("freeFrameSpot", () => {
  const size = { width: 100, height: 50 };
  test("origin on an empty canvas", () => {
    expect(freeFrameSpot([], size)).toEqual({ x: 0, y: 0, ...size });
  });

  test("right of the content, top aligned, 80px gap", () => {
    const spot = freeFrameSpot(
      [
        { x: 0, y: 40, width: 400, height: 300 },
        { x: 100, y: 10, width: 500, height: 100 },
      ],
      size,
    );
    expect(spot).toEqual({ x: 680, y: 10, ...size });
  });
});
