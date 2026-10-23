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
    const result = await fetchFigmaImport({ fileKey: "KEY", nodeId: "1:2" }, "secret", fetcher);
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
    const { fetcher } = fakeFigma({
      "/files/KEY?geometry=paths": () =>
        json({
          name: "Kit",
          document: {
            id: "0:0",
            type: "DOCUMENT",
            children: [
              {
                id: "0:1",
                type: "CANVAS",
                name: "Page 1",
                children: [{ id: "5:1", type: "FRAME" }],
              },
            ],
          },
        }),
    });
    const result = await fetchFigmaImport({ fileKey: "KEY" }, "t", fetcher);
    expect(result).toMatchObject({ name: "Kit", missingImages: 0 });
    expect(result.nodes.map((node) => node.id)).toEqual(["5:1"]);
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
