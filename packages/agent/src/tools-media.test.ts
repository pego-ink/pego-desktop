import { describe, expect, test } from "bun:test";
import { findNode } from "@pego/doc";
import { createFakeHost } from "./test-host";
import { mediaTools } from "./tools-media";
import type { ToolHost } from "./types";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const call = async (name: string, input: unknown, host: ToolHost = createFakeHost()) => {
  const tool = mediaTools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.run(input, host);
  return { host, isError: result.isError, data: JSON.parse(result.content) as Json };
};

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0E7C5A"/><path d="M7 12l3 3 7-7" stroke="#fff" stroke-width="2" fill="none"/></svg>';

describe("mediaTools", () => {
  test("registers the media tools with object input schemas", () => {
    expect(mediaTools.map((t) => t.name)).toEqual([
      "insert_svg",
      "place_image",
      "generate_image",
      "search_images",
    ]);
    for (const tool of mediaTools) expect(tool.inputSchema.type).toBe("object");
  });
});

describe("place_image with attachment src", () => {
  const withAttachments = () =>
    Object.assign(createFakeHost(), {
      getAttachment: (id: string) =>
        id === "att-1" ? { src: PNG, name: "hero-photo.png" } : undefined,
    });

  test("resolves attachment:<id> through the host and names the layer after the file", async () => {
    const host = withAttachments();
    const { isError, data } = await call(
      "place_image",
      { src: "attachment:att-1", width: 300 },
      host,
    );
    expect(isError).toBe(false);
    const node = findNode(host.getDoc(), data.created.id);
    expect(node).toMatchObject({ type: "image", src: PNG, name: "hero-photo", width: 300 });
  });

  test("an explicit name wins", async () => {
    const host = withAttachments();
    const { data } = await call("place_image", { src: "attachment:att-1", name: "Hero" }, host);
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({ name: "Hero" });
  });

  test("unknown id is a clear error and leaves the document alone", async () => {
    const host = withAttachments();
    const before = host.getDoc();
    const { isError, data } = await call("place_image", { src: "attachment:att-9" }, host);
    expect(isError).toBe(true);
    expect(data.error.code).toBe("unknown_attachment");
    expect(data.error.message).toContain("att-9");
    expect(host.getDoc()).toBe(before);
  });

  test("a host without attachments says so", async () => {
    const { isError, data } = await call("place_image", { src: "attachment:att-1" });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("unknown_attachment");
    expect(data.error.message).toContain("no attachments");
  });
});

describe("insert_svg", () => {
  test("inserts editable nodes in one op and returns ids and size", async () => {
    const { host, isError, data } = await call("insert_svg", { svg: SVG, width: 48, x: 5, y: 6 });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ ok: true, width: 48, height: 48 });
    expect((host as ReturnType<typeof createFakeHost>).calls.applyOps).toHaveLength(1);
    const frame = findNode(host.getDoc(), data.created.id);
    expect(frame).toMatchObject({ type: "group", x: 5, y: 6, width: 48 });
    expect(data.created.children.map((c: Json) => c.type)).toEqual(["ellipse", "path"]);
  });

  test("inserts into a parent frame", async () => {
    const host = createFakeHost();
    const parent = host.getDoc().children[0]?.children.find((n) => n.type === "frame");
    if (!parent) throw new Error("sample doc has no frame");
    const { isError, data } = await call("insert_svg", { svg: SVG, parentId: parent.id }, host);
    expect(isError).toBe(false);
    const inserted = findNode(host.getDoc(), data.created.id);
    expect(inserted?.type).toBe("group");
  });

  test("unsafe svg returns a coded error and leaves the document untouched", async () => {
    const host = createFakeHost();
    const before = host.getDoc();
    const { isError, data } = await call(
      "insert_svg",
      { svg: '<svg viewBox="0 0 1 1"><script>x</script></svg>' },
      host,
    );
    expect(isError).toBe(true);
    expect(data.error.code).toBe("unsafe_svg");
    expect(host.getDoc()).toBe(before);
  });

  test("unknown parent and bad input are reported", async () => {
    expect((await call("insert_svg", { svg: SVG, parentId: "nope" })).data.error.code).toBe(
      "parent_not_found",
    );
    expect((await call("insert_svg", { svg: "" })).data.error.code).toBe("invalid_input");
    expect((await call("insert_svg", { svg: SVG, extra: 1 })).data.error.code).toBe(
      "invalid_input",
    );
  });

  test("warnings are surfaced", async () => {
    const { data } = await call("insert_svg", {
      svg: '<svg viewBox="0 0 10 10"><rect width="5" height="5" filter="url(#f)"/></svg>',
    });
    expect(data.warnings.join(" ")).toMatch(/filter/);
  });
});

describe("place_image", () => {
  test("places an https image with defaults", async () => {
    const { host, isError, data } = await call("place_image", {
      src: "https://example.com/a.jpg",
      width: 300,
      height: 200,
      alt: "A photo",
    });
    expect(isError).toBe(false);
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({
      type: "image",
      src: "https://example.com/a.jpg",
      fit: "fill",
      width: 300,
      height: 200,
      alt: "A photo",
    });
  });

  test("accepts data:image URLs", async () => {
    const { isError } = await call("place_image", { src: PNG, fit: "fit" });
    expect(isError).toBe(false);
  });

  test("rejects other schemes, svg data URLs, private hosts, credentials and oversize data", async () => {
    const bad = [
      "http://example.com/a.png",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html;base64,PGgxPg==",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "https://localhost/a.png",
      "https://192.168.1.4/a.png",
      "https://user:pw@example.com/a.png",
      "not a url",
      `data:image/png;base64,${"A".repeat(8 * 1024 * 1024)}`,
    ];
    for (const src of bad) {
      const { isError, data } = await call("place_image", { src });
      expect(isError).toBe(true);
      expect(data.error.code).toBe("invalid_src");
    }
  });
});

describe("generate_image", () => {
  test("returns unsupported when the host has no generator", async () => {
    const { isError, data } = await call("generate_image", {
      prompt: "a cat",
      width: 512,
      height: 512,
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe("unsupported");
    expect(data.error.message).toMatch(
      /OpenAI-compatible provider with an image model in Model settings/,
    );
  });

  test("places the generated image and passes style in the prompt", async () => {
    const requests: Json[] = [];
    const host = Object.assign(createFakeHost(), {
      generateImage: async (request: Json) => {
        requests.push(request);
        return { src: PNG, alt: "a cat" };
      },
    });
    const { isError, data } = await call(
      "generate_image",
      { prompt: "a cat", width: 640, height: 480, style: "watercolor" },
      host,
    );
    expect(isError).toBe(false);
    expect(requests[0]).toMatchObject({ width: 640, height: 480 });
    expect(requests[0]?.prompt).toContain("Style: watercolor");
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({
      type: "image",
      src: PNG,
      width: 640,
      height: 480,
      alt: "a cat",
    });
  });

  test("maps host failures and validates host output", async () => {
    const failing = Object.assign(createFakeHost(), {
      generateImage: async () => {
        throw new Error("provider exploded");
      },
    });
    const a = await call("generate_image", { prompt: "x", width: 256, height: 256 }, failing);
    expect(a.data.error).toMatchObject({ code: "generation_failed", message: "provider exploded" });

    const unsupported = Object.assign(createFakeHost(), {
      generateImage: async () => {
        throw Object.assign(new Error("Add a provider"), { name: "ImageUnsupportedError" });
      },
    });
    const b = await call("generate_image", { prompt: "x", width: 256, height: 256 }, unsupported);
    expect(b.data.error).toMatchObject({ code: "unsupported", message: "Add a provider" });

    const evil = Object.assign(createFakeHost(), {
      generateImage: async () => ({ src: "http://evil.test/a.png" }),
    });
    const c = await call("generate_image", { prompt: "x", width: 256, height: 256 }, evil);
    expect(c.data.error.code).toBe("invalid_src");
  });

  test("validates dimensions", async () => {
    const host = Object.assign(createFakeHost(), { generateImage: async () => ({ src: PNG }) });
    expect(
      (await call("generate_image", { prompt: "x", width: 10, height: 256 }, host)).data.error.code,
    ).toBe("invalid_input");
    expect(
      (await call("generate_image", { prompt: "x", width: 99999, height: 256 }, host)).data.error
        .code,
    ).toBe("invalid_input");
  });
});

describe("search_images", () => {
  const photo = {
    src: "https://api.openverse.org/v1/images/abc/thumb/?full_size=true",
    thumb: "https://api.openverse.org/v1/images/abc/thumb/",
    width: 1024,
    height: 768,
    title: "Basic Fried Chicken",
    creator: "Cooking With Lon",
    license: "CC BY 2.0",
    pageUrl: "https://www.flickr.com/photos/x/6050446406",
    provider: "Openverse",
  };

  test("without the capability it is unsupported", async () => {
    const { data } = await call("search_images", { query: "chicken" });
    expect(data.error.code).toBe("unsupported");
  });

  test("returns candidates with their credit; unsafe sources are dropped", async () => {
    const requests: Json[] = [];
    const host = Object.assign(createFakeHost(), {
      searchImages: async (request: Json) => {
        requests.push(request);
        return [photo, { ...photo, src: "http://insecure.test/a.jpg" }];
      },
    });
    const { isError, data } = await call(
      "search_images",
      { query: "fried chicken", count: 4, orientation: "landscape" },
      host,
    );
    expect(isError).toBe(false);
    expect(requests[0]).toEqual({ query: "fried chicken", count: 4, orientation: "landscape" });
    expect(data.results).toEqual([
      {
        src: photo.src,
        width: 1024,
        height: 768,
        title: "Basic Fried Chicken",
        creator: "Cooking With Lon",
        license: "CC BY 2.0",
        pageUrl: photo.pageUrl,
        credit: "Basic Fried Chicken by Cooking With Lon (CC BY 2.0, via Openverse)",
      },
    ]);
  });

  test("an empty search hints at other words; failures are reported", async () => {
    const none = Object.assign(createFakeHost(), { searchImages: async () => [] });
    expect((await call("search_images", { query: "zzz" }, none)).data.hint).toMatch(/other words/);
    const broken = Object.assign(createFakeHost(), {
      searchImages: async () => {
        throw new Error("offline");
      },
    });
    expect((await call("search_images", { query: "x" }, broken)).data.error).toMatchObject({
      code: "search_failed",
      message: "offline",
    });
  });

  test("place_image keeps the photo's page as the layer's source", async () => {
    const { data, host } = await call("place_image", {
      src: photo.src,
      width: 400,
      height: 300,
      alt: "Fried chicken",
      sourceUrl: photo.pageUrl,
    });
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({
      type: "image",
      src: photo.src,
      source: { url: photo.pageUrl },
    });
    const bad = await call("place_image", { src: photo.src, sourceUrl: "javascript:alert(1)" });
    expect(bad.data.error.code).toBe("invalid_input");
  });
});

describe("place_image embeds web images", () => {
  const withFetch = (fetchImage: (url: string) => Promise<string>) =>
    Object.assign(createFakeHost(), { fetchImage });

  test("an https src is downloaded into the file, the page kept for credit", async () => {
    const seen: string[] = [];
    const host = withFetch(async (url) => {
      seen.push(url);
      return PNG;
    });
    const { isError, data } = await call(
      "place_image",
      { src: "https://cdn.example/fire.jpg", sourceUrl: "https://news.example/story" },
      host,
    );
    expect(isError).toBe(false);
    expect(seen).toEqual(["https://cdn.example/fire.jpg"]);
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({
      src: PNG,
      source: { url: "https://news.example/story" },
    });
  });

  test("a download that fails is an error the agent can act on, and changes nothing", async () => {
    const host = withFetch(async () => {
      throw new Error("blocked");
    });
    const before = host.getDoc();
    const { isError, data } = await call("place_image", { src: "https://cdn.example/x.jpg" }, host);
    expect(isError).toBe(true);
    expect(data.error.code).toBe("image_unavailable");
    expect(data.error.message).toContain("cdn.example");
    expect(host.getDoc()).toBe(before);
  });

  test("data URLs are placed as they are", async () => {
    const host = withFetch(async () => {
      throw new Error("should not be called");
    });
    const { isError } = await call("place_image", { src: PNG }, host);
    expect(isError).toBe(false);
  });
});
