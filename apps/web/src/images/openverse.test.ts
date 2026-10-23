/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { licenseLabel, parseResults, searchOpenverse, searchUrl } from "./openverse";

const item = {
  id: "7829cee9-e262-42df-8889-218be5fa546f",
  title: "Basic Fried Chicken",
  creator: "Cooking With Lon",
  license: "by",
  license_version: "2.0",
  foreign_landing_url: "https://www.flickr.com/photos/47123049@N07/6050446406",
  url: "https://live.staticflickr.com/6071/6050446406_86f3b5bfa4_b.jpg",
  width: 768,
  height: 1024,
};

describe("openverse", () => {
  test("asks for commercial-use licenses, no mature results, and the shape", () => {
    const url = new URL(searchUrl({ query: "fried chicken", count: 50, orientation: "portrait" }));
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "fried chicken",
      page_size: "20",
      license_type: "commercial",
      mature: "false",
      aspect_ratio: "tall",
    });
  });

  test("results load through Openverse's proxy and carry their credit", () => {
    expect(parseResults({ results: [item] })).toEqual([
      {
        src: `https://api.openverse.org/v1/images/${item.id}/thumb/?full_size=true`,
        thumb: `https://api.openverse.org/v1/images/${item.id}/thumb/`,
        width: 768,
        height: 1024,
        title: "Basic Fried Chicken",
        creator: "Cooking With Lon",
        license: "CC BY 2.0",
        pageUrl: item.foreign_landing_url,
        provider: "Openverse",
      },
    ]);
  });

  test("malformed items are skipped, not trusted", () => {
    expect(
      parseResults({
        results: [
          { ...item, id: "../../evil" },
          { ...item, foreign_landing_url: "javascript:alert(1)", detail_url: undefined },
          { ...item, license: undefined },
          "nope",
        ],
      }),
    ).toEqual([]);
    expect(parseResults(null)).toEqual([]);
  });

  test("license labels", () => {
    expect(licenseLabel("by-sa", "2.0")).toBe("CC BY-SA 2.0");
    expect(licenseLabel("cc0", "1.0")).toBe("CC0 1.0");
    expect(licenseLabel("pdm")).toBe("Public Domain Mark");
  });

  test("network failures become readable errors", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(searchOpenverse({ query: "x", count: 1 }, offline)).rejects.toThrow(
      "Could not reach Openverse",
    );
    const limited = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(searchOpenverse({ query: "x", count: 1 }, limited)).rejects.toThrow("HTTP 429");
  });
});
