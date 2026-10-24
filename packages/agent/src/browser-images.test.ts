import { describe, expect, test } from "bun:test";
import {
  FIND_IMAGES_EXPRESSION,
  siteImage,
  MAX_PAGE_IMAGES,
  googleImagesUrl,
  isGoogleInterstitial,
  pageImages,
} from "./browser-images";

describe("pageImages", () => {
  test("originals first, unescaped, without Google's own images, small ones or repeats", () => {
    const images = pageImages({
      originals: [
        {
          url: "https://bpbd.riau.go.id/img/fire.webp?w\\u003d800\\u0026q\\u003d1",
          width: 567,
          height: 255,
        },
        {
          url: "https://bpbd.riau.go.id/img/fire.webp?w\\u003d800\\u0026q\\u003d1",
          width: 567,
          height: 255,
        },
        { url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc", width: 300, height: 200 },
        { url: "http://insecure.example/a.jpg", width: 800, height: 600 },
        { url: "https://cdn.example/tiny.png", width: 40, height: 40 },
      ],
      images: [
        {
          url: "https://news.example/photo.jpg",
          width: 640,
          height: 360,
          alt: " Smoke over Pekanbaru ",
          link: "https://news.example/story",
        },
        { url: "https://www.google.com/logos/doodle.png", width: 400, height: 200 },
        { url: "data:image/png;base64,AAA", width: 300, height: 300 },
      ],
    });
    expect(images).toEqual([
      { url: "https://bpbd.riau.go.id/img/fire.webp?w=800&q=1", width: 567, height: 255 },
      {
        url: "https://news.example/photo.jpg",
        width: 640,
        height: 360,
        alt: "Smoke over Pekanbaru",
        pageUrl: "https://news.example/story",
      },
    ]);
  });

  test("at most the limit, and nothing for page data that is not the expected shape", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      url: `https://cdn.example/${i}.jpg`,
      width: 800,
      height: 600,
    }));
    expect(pageImages({ originals: many })).toHaveLength(MAX_PAGE_IMAGES);
    expect(pageImages("not an object")).toEqual([]);
    expect(pageImages({ originals: [{ url: 1 }] })).toEqual([]);
  });
});

describe("Google Images", () => {
  test("the image tab URL for a query", () => {
    expect(googleImagesUrl(" kebakaran hutan & asap ")).toBe(
      "https://www.google.com/search?udm=2&q=kebakaran%20hutan%20%26%20asap",
    );
  });

  test("its check and consent pages are recognized", () => {
    expect(isGoogleInterstitial("https://www.google.com/sorry/index?continue=x")).toBe(true);
    expect(isGoogleInterstitial("https://consent.google.com/ml?continue=x")).toBe(true);
    expect(isGoogleInterstitial("https://www.google.com/search?udm=2&q=x")).toBe(false);
  });

  test("the page script is one expression that only reads the document", () => {
    expect(FIND_IMAGES_EXPRESSION.trim()).toStartWith("(() => {");
    expect(FIND_IMAGES_EXPRESSION.trim()).toEndWith("})()");
    expect(FIND_IMAGES_EXPRESSION).not.toMatch(/fetch\(|XMLHttpRequest|\.click\(|location\s*=/);
  });
});

describe("site rules", () => {
  test("Pinterest thumbnails become the 736px pin, its interface images are skipped", () => {
    expect(
      siteImage({ url: "https://i.pinimg.com/236x/3f/4d/24/a.jpg", width: 236, height: 419 }),
    ).toEqual({
      url: "https://i.pinimg.com/736x/3f/4d/24/a.jpg",
      width: 736,
      height: 1307,
    });
    const original = {
      url: "https://i.pinimg.com/originals/3f/4d/24/a.jpg",
      width: 944,
      height: 1676,
    };
    expect(siteImage(original)).toBe(original);
    expect(
      siteImage({ url: "https://s.pinimg.com/gestalt/x.webp", width: 220, height: 220 }),
    ).toBeNull();
  });

  test("Unsplash+ photos carry a paid-license note, SVG artwork is skipped", () => {
    expect(
      siteImage({
        url: "https://plus.unsplash.com/premium_photo-1?w=2000",
        width: 2000,
        height: 1500,
      })?.note,
    ).toMatch(/paid/);
    expect(
      siteImage({ url: "https://images.unsplash.com/photo-1?w=2000", width: 2000, height: 1500 })
        ?.note,
    ).toBeUndefined();
    expect(siteImage({ url: "https://cdn.example/logo.svg", width: 400, height: 400 })).toBeNull();
  });

  test("pictures shown as avatars or icons are left out, whatever their file size", () => {
    const images = pageImages({
      images: [
        { url: "https://cdn.example/avatar.jpg", width: 400, height: 400, shown: 32 },
        { url: "https://cdn.example/shot.jpg", width: 1600, height: 1200, shown: 355 },
        { url: "https://cdn.example/lazy.jpg", width: 1200, height: 900, shown: 0 },
      ],
    });
    expect(images.map((i) => i.url)).toEqual([
      "https://cdn.example/shot.jpg",
      "https://cdn.example/lazy.jpg",
    ]);
  });
});
