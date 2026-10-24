import { describe, expect, test } from "bun:test";
import type { StockImage } from "@pego/agent";
import { searchPhotos } from "./image-search";
import {
  WEB_IMAGES_PROVIDER,
  WEB_IMAGE_LICENSE,
  searchWebImages,
  toWebResults,
  type WebSearchBrowser,
} from "./web-image-search";

const RESULTS = "https://www.google.com/search?udm=2&q=asap";

const page = {
  originals: [
    { url: "https://cdn.antaranews.com/karhut.jpg", width: 1200, height: 800 },
    { url: "https://news.example/tall.jpg", width: 600, height: 1200 },
  ],
  images: [
    {
      url: "https://www.example.org/square.png",
      width: 500,
      height: 500,
      alt: "Smoke",
      link: "https://www.example.org/story",
    },
  ],
};

const fakeBrowser = (landing = RESULTS, value: unknown = page) => {
  const loaded: string[] = [];
  const browser: WebSearchBrowser = {
    load: async (url) => {
      loaded.push(url);
      return { url: landing };
    },
    cdp: async () => ({ result: { value } }),
  };
  return { browser, loaded };
};

describe("web image results", () => {
  test("become stock results crediting the site, the asked orientation first", () => {
    const [first, ...rest] = toWebResults(
      [
        { url: "https://a.example/wide.jpg", width: 1600, height: 900 },
        {
          url: "https://b.example/tall.jpg",
          width: 600,
          height: 1200,
          pageUrl: "https://b.example/p",
        },
      ],
      RESULTS,
      { count: 5, orientation: "portrait" },
    );
    expect(first).toEqual({
      src: "https://b.example/tall.jpg",
      thumb: "https://b.example/tall.jpg",
      width: 600,
      height: 1200,
      title: "Image from b.example",
      creator: "b.example",
      license: WEB_IMAGE_LICENSE,
      pageUrl: "https://b.example/p",
      provider: WEB_IMAGES_PROVIDER,
    });
    expect(rest[0]).toMatchObject({ src: "https://a.example/wide.jpg", pageUrl: RESULTS });
  });

  test("searchWebImages opens Google Images and reads the page", async () => {
    const { browser, loaded } = fakeBrowser();
    const images = await searchWebImages(browser, { query: "asap riau", count: 2 });
    expect(loaded).toEqual(["https://www.google.com/search?udm=2&q=asap%20riau"]);
    expect(images.map((i) => i.src)).toEqual([
      "https://cdn.antaranews.com/karhut.jpg",
      "https://news.example/tall.jpg",
    ]);
    expect(images[1]!.title).toBe("Image from news.example");
  });

  test("Google's check page is a readable error", async () => {
    const { browser } = fakeBrowser("https://www.google.com/sorry/index?x=1");
    expect(searchWebImages(browser, { query: "x", count: 4 })).rejects.toThrow(/check/);
  });
});

describe("searchPhotos", () => {
  const free: StockImage[] = [
    {
      src: "https://api.openverse.org/v1/images/a/thumb/?full_size=true",
      thumb: "https://api.openverse.org/v1/images/a/thumb/",
      title: "Free",
      license: "CC0 1.0",
      pageUrl: "https://openverse.org/image/a",
      provider: "Openverse",
    },
  ];
  const openverse = async () => free;

  test("uses the built-in browser when there is one", async () => {
    const { browser } = fakeBrowser();
    const { images, note } = await searchPhotos(
      { query: "asap", count: 3 },
      { reveal: false, browser, openverse },
    );
    expect(images[0]!.provider).toBe(WEB_IMAGES_PROVIDER);
    expect(note).toBeUndefined();
  });

  test("falls back to Openverse with a note when Google is blocked or empty", async () => {
    const blocked = fakeBrowser("https://www.google.com/sorry/index").browser;
    const result = await searchPhotos(
      { query: "x", count: 3 },
      { reveal: false, browser: blocked, openverse },
    );
    expect(result.images).toBe(free);
    expect(result.note).toMatch(/check in the Browser panel.*Openverse instead/);
    const empty = fakeBrowser(RESULTS, { originals: [], images: [] }).browser;
    const none = await searchPhotos(
      { query: "x", count: 3 },
      { reveal: false, browser: empty, openverse },
    );
    expect(none.note).toBe("Google showed no photos. Showing free photos from Openverse instead.");
  });

  test("without a browser it is Openverse, quietly", async () => {
    expect(
      await searchPhotos({ query: "x", count: 3 }, { reveal: false, browser: null, openverse }),
    ).toEqual({ images: free });
  });
});
