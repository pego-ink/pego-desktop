/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { fetchFigmaImport, parseFigmaUrl } from "./figma-api";

describe("figma links", () => {
  test("file key and layer id from the usual link shapes", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/My-file?node-id=12-34&t=x")).toEqual({
      fileKey: "AbC123",
      nodeId: "12:34",
    });
    expect(parseFigmaUrl("https://figma.com/file/XyZ9/Old")).toEqual({ fileKey: "XyZ9" });
    expect(parseFigmaUrl("https://www.figma.com/proto/K1/P?node-id=1%3A2")).toEqual({
      fileKey: "K1",
      nodeId: "1:2",
    });
    expect(parseFigmaUrl("https://example.com/design/AbC123")).toBeNull();
    expect(parseFigmaUrl("not a link")).toBeNull();
  });
});

/** A fake api.figma.com that records the calls and their token header. */
const fakeFigma = (routes: Record<string, () => Response>) => {
  const calls: { url: string; token: string | null }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, token: new Headers(init?.headers).get("X-Figma-Token") });
    const route = Object.keys(routes).find((key) => url.includes(key));
    return route ? routes[route]!() : new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
};

const json = (body: unknown) => Response.json(body);

describe("fetching a design", () => {
  test("a linked frame with an image fill: the frame, and the image embedded", async () => {
    const frame = {
      id: "1:2",
      name: "Hero",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "IMAGE", imageRef: "ref1" }],
    };
    const { calls, fetcher } = fakeFigma({
      "/files/KEY/nodes?ids=1%3A2&geometry=paths": () =>
        json({ name: "File", nodes: { "1:2": { document: frame } } }),
      "/files/KEY/images": () => json({ meta: { images: { ref1: "https://s3.test/ref1" } } }),
      "s3.test/ref1": () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
    });
    const result = await fetchFigmaImport(
      { fileKey: "KEY", nodeId: "1:2" },
      "secret",
      fetcher,
      async (image) => image,
    );
    expect(result.name).toBe("Hero");
    expect(result.nodes.map((node) => node.id)).toEqual(["1:2"]);
    expect(result.images.get("ref1")).toBe("data:image/png;base64,iVBORw==");
    expect(result.missingImages).toBe(0);
    // The token goes to Figma's API only, never to the image host.
    expect(
      calls
        .filter((call) => call.url.startsWith("https://api.figma.com/"))
        .every((c) => c.token === "secret"),
    ).toBe(true);
    expect(calls.find((call) => call.url.includes("s3.test"))?.token).toBeNull();
  });

  test("without a layer: the first page's top-level layers", async () => {
    const { calls, fetcher } = fakeFigma({
      "/files/KEY?depth=1": () =>
        json({
          name: "Kit",
          document: {
            id: "0:0",
            type: "DOCUMENT",
            children: [
              { id: "0:1", type: "CANVAS", name: "Page 1" },
              { id: "0:2", type: "CANVAS", name: "Page 2" },
            ],
          },
        }),
      "/files/KEY/nodes?ids=0%3A1&geometry=paths": () =>
        json({
          nodes: {
            "0:1": {
              document: {
                id: "0:1",
                type: "CANVAS",
                name: "Page 1",
                children: [{ id: "5:1", type: "FRAME" }],
              },
            },
          },
        }),
    });
    const result = await fetchFigmaImport({ fileKey: "KEY" }, "t", fetcher);
    // Never the whole file: only the first page is fetched with geometry.
    expect(calls.map((call) => call.url.replace("https://api.figma.com/v1", ""))).toEqual([
      "/files/KEY?depth=1",
      "/files/KEY/nodes?ids=0%3A1&geometry=paths",
    ]);
    expect(result).toMatchObject({ name: "Kit", missingImages: 0 });
    expect(result.nodes.map((node) => node.id)).toEqual(["5:1"]);
  });

  const imageFrame = (refs: string[]) => ({
    id: "1:2",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    children: refs.map((imageRef, index) => ({
      id: `1:${index + 3}`,
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      fills: [{ type: "IMAGE", imageRef }],
    })),
  });
  const png =
    (bytes: number, headers: Record<string, string> = {}) =>
    () =>
      new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png", ...headers } });
  const imageRoutes = (refs: string[], routes: Record<string, () => Response>) => ({
    "/files/KEY/nodes?ids=1%3A2": () => json({ nodes: { "1:2": { document: imageFrame(refs) } } }),
    "/files/KEY/images": () =>
      json({ meta: { images: Object.fromEntries(refs.map((r) => [r, `https://s3.test/${r}`])) } }),
    ...routes,
  });
  const target = { fileKey: "KEY", nodeId: "1:2" };
  const identity = async (image: { bytes: Uint8Array; type: string }) => image;

  test("an image whose content-length is over the cap is not read", async () => {
    let read = false;
    const { fetcher } = fakeFigma(
      imageRoutes(["a"], {
        "s3.test/a": () => {
          const response = png(4, { "content-length": String(6 * 1024 * 1024) })();
          const spy = response.arrayBuffer.bind(response);
          response.arrayBuffer = () => {
            read = true;
            return spy();
          };
          return response;
        },
      }),
    );
    const result = await fetchFigmaImport(target, "t", fetcher, identity);
    expect(read).toBe(false);
    expect(result.missingImages).toBe(1);
  });

  test("images past the total budget are skipped with a warning", async () => {
    const refs = ["a", "b", "c", "d", "e", "f", "g"];
    const { fetcher } = fakeFigma(
      imageRoutes(
        refs,
        Object.fromEntries(refs.map((ref) => [`s3.test/${ref}`, png(4 * 1024 * 1024)])),
      ),
    );
    const result = await fetchFigmaImport(target, "t", fetcher, identity);
    // 4 MB of bytes is ~5.6 MB of base64: four fit in 25 MB.
    expect(result.images.size).toBe(4);
    expect(result.missingImages).toBe(3);
    expect(result.warnings.join(" ")).toContain("budget");
  });

  test("images are shrunk before embedding", async () => {
    const { fetcher } = fakeFigma(imageRoutes(["a"], { "s3.test/a": png(4) }));
    const result = await fetchFigmaImport(target, "t", fetcher, async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      type: "image/webp",
    }));
    expect(result.images.get("a")).toBe("data:image/webp;base64,AQID");
  });

  test("errors say what to do, without the token", async () => {
    const { fetcher } = fakeFigma({ "/files/KEY": () => new Response("", { status: 403 }) });
    const error = await fetchFigmaImport({ fileKey: "KEY" }, "very-secret", fetcher).catch(
      (e) => e,
    );
    expect(String(error)).toContain("Figma refused the token");
    expect(String(error)).not.toContain("very-secret");
  });
});
