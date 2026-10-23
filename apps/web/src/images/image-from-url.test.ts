/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  fileNameFor,
  imageLinkFromHtml,
  imageLinkFromText,
  loadImageFromUrl,
} from "./image-from-url";

const png = () =>
  new Response(new Uint8Array([0x89, 0x50]), { headers: { "content-type": "image/png" } });

describe("image links", () => {
  test("pasted text that is just a link to an image file", () => {
    expect(imageLinkFromText(" https://cdn.test/a/photo.JPG?w=800 ")).toBe(
      "https://cdn.test/a/photo.JPG?w=800",
    );
    expect(imageLinkFromText("https://cdn.test/page.html")).toBeNull();
    expect(imageLinkFromText("http://cdn.test/a.png")).toBeNull();
    expect(imageLinkFromText("look at https://cdn.test/a.png")).toBeNull();
  });

  test("HTML from 'Copy image' is an image; HTML with text is a text paste", () => {
    expect(
      imageLinkFromHtml(
        '<meta charset="utf-8"><img src="https://cdn.test/a.webp?x=1&amp;y=2" alt="Rendang">',
      ),
    ).toBe("https://cdn.test/a.webp?x=1&y=2");
    expect(
      imageLinkFromHtml('<p>Our menu <img src="https://cdn.test/a.png"> today</p>'),
    ).toBeNull();
    expect(
      imageLinkFromHtml('<img src="https://a.test/1.png"><img src="https://a.test/2.png">'),
    ).toBeNull();
    expect(imageLinkFromHtml('<img src="data:image/png;base64,AAAA">')).toBeNull();
  });

  test("download names", () => {
    expect(fileNameFor("https://cdn.test/img/ayam%20pop.jpg", "image/jpeg")).toBe("ayam pop.jpg");
    expect(fileNameFor("https://cdn.test/render?id=3", "image/webp")).toBe("render.webp");
    expect(fileNameFor("https://cdn.test/", "image/png")).toBe("image.png");
  });
});

describe("loadImageFromUrl", () => {
  test("fetches directly when the site allows it", async () => {
    const asked: string[] = [];
    const blob = await loadImageFromUrl("https://cdn.test/a.png", {
      fetch: (async (url: string) => {
        asked.push(String(url));
        return png();
      }) as unknown as typeof fetch,
      bridgeConnected: () => true,
    });
    expect(blob.type).toBe("image/png");
    expect(asked).toEqual(["https://cdn.test/a.png"]);
  });

  test("falls back to the bridge when CORS blocks the direct fetch", async () => {
    const asked: string[] = [];
    const blob = await loadImageFromUrl("https://cdn.test/a.png", {
      fetch: (async (url: string) => {
        asked.push(String(url));
        if (String(url).startsWith("https://cdn.test")) throw new TypeError("Failed to fetch");
        return png();
      }) as unknown as typeof fetch,
      bridgeConnected: () => true,
      bridgeUrl: (path) => `http://127.0.0.1:4519${path}`,
    });
    expect(blob.type).toBe("image/png");
    expect(asked[1]).toBe("http://127.0.0.1:4519/fetch-image?url=https%3A%2F%2Fcdn.test%2Fa.png");
  });

  test("explains what to do without a bridge; bridge errors come through", async () => {
    const blocked = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(
      loadImageFromUrl("https://cdn.test/a.png", { fetch: blocked, bridgeConnected: () => false }),
    ).rejects.toThrow(/Start the Pego bridge/);
    await expect(
      loadImageFromUrl("https://cdn.test/a.png", {
        fetch: (async (url: string) => {
          if (String(url).startsWith("https://")) throw new TypeError("Failed to fetch");
          return new Response("That address is on a private network.", { status: 403 });
        }) as unknown as typeof fetch,
        bridgeConnected: () => true,
        bridgeUrl: (path) => `http://127.0.0.1:4519${path}`,
      }),
    ).rejects.toThrow("That address is on a private network.");
  });

  test("a page that is not an image is refused, not retried", async () => {
    let calls = 0;
    await expect(
      loadImageFromUrl("https://cdn.test/a.png", {
        fetch: (async () => {
          calls++;
          return new Response("<html>", { headers: { "content-type": "text/html" } });
        }) as unknown as typeof fetch,
        bridgeConnected: () => true,
      }),
    ).rejects.toThrow("not an image");
    expect(calls).toBe(1);
  });
});
