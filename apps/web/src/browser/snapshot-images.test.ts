import { describe, expect, test } from "bun:test";
import type { DomSnapshot, DomSnapshotNode } from "@pego/agent";
import {
  createBudget,
  dataUrlBytes,
  dataUrlMime,
  fitScale,
  inlineSnapshotImages,
  mapLimit,
  needsNormalization,
  rasterClip,
  remoteBackgroundUrls,
  replaceBackgroundUrls,
} from "./snapshot-images";

const box = { x: 0, y: 0, width: 10, height: 10 };
const el = (children: DomSnapshotNode[], style = {}): DomSnapshotNode => ({
  kind: "element",
  tag: "div",
  box,
  style,
  children,
});
const snap = (root: DomSnapshotNode): DomSnapshot => ({ url: "https://x.test", title: "", root });
const png = (n: number) => `data:image/png;base64,${"A".repeat(n)}`;

describe("helpers", () => {
  test("data URL size and mime", () => {
    expect(dataUrlBytes(png(400))).toBe(300);
    expect(dataUrlMime("data:IMAGE/SVG+xml;base64,xx")).toBe("image/svg+xml");
    expect(dataUrlMime("https://x")).toBe("");
  });

  test("normalization decision", () => {
    for (const t of ["png", "jpeg", "webp", "gif"]) {
      expect(needsNormalization(`data:image/${t};base64,xx`)).toBe(false);
    }
    for (const t of ["svg+xml", "avif", "bmp", "x-icon"]) {
      expect(needsNormalization(`data:image/${t};base64,xx`)).toBe(true);
    }
  });

  test("fitScale never enlarges", () => {
    expect(fitScale(5000, 1000, 2560)).toBeCloseTo(0.512);
    expect(fitScale(100, 100, 2560)).toBe(1);
  });

  test("rasterClip is 2x, capped at 2048 on the long side", () => {
    expect(rasterClip({ x: 1, y: 2, width: 300, height: 200 }).scale).toBe(2);
    const big = rasterClip({ x: 0, y: 0, width: 4096, height: 100 });
    expect(big.scale).toBe(0.5);
  });

  test("budget refuses what does not fit", () => {
    const b = createBudget(100);
    expect(b.take(60)).toBe(true);
    expect(b.take(50)).toBe(false);
    expect(b.take(40)).toBe(true);
    expect(b.used()).toBe(100);
  });

  test("background urls", () => {
    const css = `linear-gradient(red, blue), url("https://a.test/x.png"), url(data:image/png;base64,AA), url('http://b.test/y.svg')`;
    expect(remoteBackgroundUrls(css)).toEqual(["https://a.test/x.png", "http://b.test/y.svg"]);
    expect(
      replaceBackgroundUrls(css, (u) =>
        u.includes("a.test") ? "data:image/png;base64,ZZ" : undefined,
      ),
    ).toBe(
      `linear-gradient(red, blue), url("data:image/png;base64,ZZ"), url(data:image/png;base64,AA), url('http://b.test/y.svg')`,
    );
  });

  test("mapLimit bounds concurrency", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBe(3);
  });
});

describe("inlineSnapshotImages", () => {
  const base = {
    ensureVisible: async () => {},
    capture: async () => png(40),
    normalize: async () => "data:image/webp;base64,NORM",
    warn: () => {},
  };

  test("fills rasters, inlines remote images and backgrounds, normalizes svg", async () => {
    const raster: DomSnapshotNode = {
      kind: "image",
      tag: "video",
      raster: true,
      src: "",
      box,
      style: {},
    };
    const img: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/a.svg",
      box,
      style: {},
    };
    const root = el([raster, img], { backgroundImage: 'url("https://a.test/bg.png")' });
    const fetched: string[] = [];
    await inlineSnapshotImages(snap(root), {
      ...base,
      fetchImage: async (url) => {
        fetched.push(url);
        return url.endsWith(".svg") ? "data:image/svg+xml;base64,PHN2Zz4=" : png(8);
      },
    });
    expect(raster.kind === "image" && raster.src).toBe(png(40));
    expect(img.kind === "image" && img.src).toBe("data:image/webp;base64,NORM");
    expect(root.kind === "element" && root.style.backgroundImage).toBe(`url("${png(8)}")`);
    expect(fetched.sort()).toEqual(["https://a.test/a.svg", "https://a.test/bg.png"]);
  });

  test("a failed screenshot drops the raster; a failed fetch keeps the https url", async () => {
    const raster: DomSnapshotNode = {
      kind: "image",
      tag: "canvas",
      raster: true,
      src: "",
      box,
      style: {},
    };
    const img: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/a.png",
      box,
      style: {},
    };
    const root = el([raster, img]);
    await inlineSnapshotImages(snap(root), {
      ...base,
      capture: async () => {
        throw new Error("boom");
      },
      fetchImage: async () => {
        throw new Error("net");
      },
    });
    expect(root.kind === "element" && root.children).toEqual([img]);
    expect(img.kind === "image" && img.src).toBe("https://a.test/a.png");
  });

  test("the budget stops further images", async () => {
    const a: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/1.png",
      box,
      style: {},
    };
    const b: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/2.png",
      box,
      style: {},
    };
    const raster: DomSnapshotNode = {
      kind: "image",
      tag: "svg",
      raster: true,
      src: "",
      box,
      style: {},
    };
    const warnings: string[] = [];
    const root = el([raster, a, b]);
    await inlineSnapshotImages(snap(root), {
      ...base,
      budget: createBudget(330),
      warn: (m) => warnings.push(m),
      fetchImage: async () => png(200),
    });
    expect(raster.kind === "image" && raster.src).toBe(png(40));
    const inlined = [a, b].filter((n) => n.kind === "image" && n.src.startsWith("data:"));
    expect(inlined).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  test("over budget leaves links and drops rasters with a warning", async () => {
    const a: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/1.png",
      box,
      style: {},
    };
    const raster: DomSnapshotNode = {
      kind: "image",
      tag: "svg",
      raster: true,
      src: "",
      box,
      style: {},
    };
    const warnings: string[] = [];
    const root = el([raster, a]);
    await inlineSnapshotImages(snap(root), {
      ...base,
      budget: createBudget(10),
      warn: (m) => warnings.push(m),
      fetchImage: async () => png(200),
    });
    expect(root.kind === "element" && root.children).toEqual([a]);
    expect(a.kind === "image" && a.src).toBe("https://a.test/1.png");
    expect(warnings).toHaveLength(2);
  });

  test("without fetchImage remote images stay links", async () => {
    const a: DomSnapshotNode = {
      kind: "image",
      tag: "img",
      src: "https://a.test/1.png",
      box,
      style: {},
    };
    await inlineSnapshotImages(snap(el([a])), base);
    expect(a.kind === "image" && a.src).toBe("https://a.test/1.png");
  });
});
