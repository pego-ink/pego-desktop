/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { StockImage } from "@pego/agent";
import {
  creditLine,
  readDroppedGeneratedImage,
  readDroppedStockImage,
  stockImageBox,
  stockImageNode,
} from "./stock-image";

const photo: StockImage = {
  src: "https://api.openverse.org/v1/images/7829cee9-e262/thumb/?full_size=true",
  thumb: "https://api.openverse.org/v1/images/7829cee9-e262/thumb/",
  width: 768,
  height: 1024,
  title: "Basic Fried Chicken",
  creator: "Cooking With Lon",
  license: "CC BY 2.0",
  pageUrl: "https://www.flickr.com/photos/x/6050446406",
  provider: "Openverse",
};

describe("stock images", () => {
  test("a placed photo keeps its aspect ratio, 480px on the longer side", () => {
    expect(stockImageBox(photo)).toEqual({ width: 360, height: 480 });
    expect(stockImageBox({})).toEqual({ width: 480, height: 360 });
  });

  test("the layer is centered on the point and credits the photo", () => {
    expect(stockImageNode(photo, { x: 100, y: 100 }, "img1")).toEqual({
      type: "image",
      id: "img1",
      name: "Basic Fried Chicken",
      src: photo.src,
      fit: "fill",
      alt: "Basic Fried Chicken by Cooking With Lon (CC BY 2.0, via Openverse)",
      source: { url: photo.pageUrl },
      x: -80,
      y: -140,
      width: 360,
      height: 480,
    });
    expect(creditLine({ ...photo, creator: undefined })).toBe(
      "Basic Fried Chicken (CC BY 2.0, via Openverse)",
    );
  });

  test("a dropped photo is accepted only from Openverse's proxy with an https page", () => {
    expect(readDroppedStockImage(JSON.stringify(photo))).toEqual(photo);
    const other = (patch: Partial<StockImage>) =>
      readDroppedStockImage(JSON.stringify({ ...photo, ...patch }));
    expect(other({ src: "https://evil.test/a.png" })).toBeNull();
    expect(other({ thumb: "data:image/png;base64,AAAA" })).toBeNull();
    expect(other({ pageUrl: "javascript:alert(1)" })).toBeNull();
    expect(readDroppedStockImage("not json")).toBeNull();
  });
});

describe("generated images", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  test("a dragged generated image is accepted only as a base64 png, jpeg or webp", () => {
    expect(
      readDroppedGeneratedImage(
        JSON.stringify({ src: PNG, prompt: "rendang", width: 1600, height: 900 }),
      ),
    ).toEqual({ src: PNG, prompt: "rendang", width: 1600, height: 900 });
    expect(
      readDroppedGeneratedImage(JSON.stringify({ src: "https://evil.test/a.png" })),
    ).toBeNull();
    expect(
      readDroppedGeneratedImage(JSON.stringify({ src: "data:image/svg+xml;base64,PHN2Zz4=" })),
    ).toBeNull();
    expect(readDroppedGeneratedImage("{")).toBeNull();
  });

  test("a missing or odd size falls back to a square", () => {
    expect(readDroppedGeneratedImage(JSON.stringify({ src: PNG, width: -1 }))).toMatchObject({
      width: 1024,
      height: 1024,
      prompt: "Generated image",
    });
  });
});

describe("dropped web pictures", () => {
  const web = {
    src: "https://cdn.antaranews.com/karhut.jpg",
    thumb: "https://cdn.antaranews.com/karhut.jpg",
    title: "Image from antaranews.com",
    creator: "antaranews.com",
    license: "Unknown, check the source",
    pageUrl: "https://www.google.com/search?udm=2&q=asap",
    provider: "Google Images",
    width: 1200,
    height: 800,
  };

  test("are accepted from any https site and keep their provider", () => {
    expect(readDroppedStockImage(JSON.stringify(web))).toEqual(web);
  });

  test("other providers still need Openverse URLs", () => {
    expect(readDroppedStockImage(JSON.stringify({ ...web, provider: "Openverse" }))).toBeNull();
    expect(
      readDroppedStockImage(JSON.stringify({ ...web, src: "javascript:alert(1)" })),
    ).toBeNull();
  });
});
