/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  createImageGenerator,
  findImageProvider,
  geminiAspectRatio,
  geminiImage,
  ImageUnsupportedError,
  imageModelKey,
  listImageModels,
  sizeFor,
} from "./generate-image";
import type { CustomProvider } from "./providers/types";

const provider = (over: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "p1",
  name: "OpenAI",
  kind: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-4o", "gpt-image-1"],
  executorModel: "gpt-4o",
  createdAt: 1,
  ...over,
});

const SECRET = "sk-test-secret-key";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg==";

type Captured = { url: string; init: RequestInit };
const fakeFetch = (respond: () => Response) => {
  const calls: Captured[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { calls, impl };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("findImageProvider", () => {
  test("picks the first openai-compatible provider with an image model", () => {
    const providers = [
      provider({ id: "a", models: ["gpt-4o"] }),
      provider({ id: "b", kind: "anthropic-compatible", models: ["gpt-image-1"] }),
      provider({ id: "c", models: ["openai/dall-e-3", "gpt-image-1"] }),
    ];
    expect(findImageProvider(providers)).toMatchObject({
      provider: { id: "c" },
      model: "openai/dall-e-3",
    });
    expect(findImageProvider([provider({ models: ["flux-schnell"] })])?.model).toBe("flux-schnell");
    expect(findImageProvider([provider({ models: ["imagen-3.0"] })])?.model).toBe("imagen-3.0");
    expect(findImageProvider([provider({ models: ["gpt-4o"] })])).toBeNull();
    expect(findImageProvider([])).toBeNull();
  });
});

describe("sizeFor", () => {
  test("snaps to sizes each model family supports", () => {
    expect(sizeFor("gpt-image-1", 800, 800)).toBe("1024x1024");
    expect(sizeFor("gpt-image-1", 1600, 900)).toBe("1536x1024");
    expect(sizeFor("gpt-image-1", 600, 1200)).toBe("1024x1536");
    expect(sizeFor("dall-e-3", 1600, 900)).toBe("1792x1024");
    expect(sizeFor("dall-e-2", 300, 900)).toBe("1024x1024");
    expect(sizeFor("flux-dev", 1000, 500)).toBe("1024x512");
    expect(sizeFor("flux-dev", 4000, 4000)).toBe("2048x2048");
  });
});

describe("createImageGenerator", () => {
  test("rejects as unsupported when no image provider exists", async () => {
    const generate = createImageGenerator({
      listProviders: async () => [provider({ models: ["gpt-4o"] })],
    });
    const error = await generate({ prompt: "x", width: 512, height: 512 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageUnsupportedError);
    expect((error as Error).message).toMatch(
      /Add an OpenAI-compatible provider with an image model/,
    );
  });

  test("rejects as unsupported when the remote provider has no key", async () => {
    const generate = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => null,
    });
    const error = await generate({ prompt: "x", width: 512, height: 512 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageUnsupportedError);
  });

  test("calls /images/generations and returns a data URL", async () => {
    const { calls, impl } = fakeFetch(() =>
      json({ data: [{ b64_json: PNG_B64, revised_prompt: "a red cat" }] }),
    );
    const generate = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => SECRET,
      fetch: impl,
    });
    const result = await generate({ prompt: "a cat", width: 1600, height: 900 });
    expect(result).toEqual({ src: `data:image/png;base64,${PNG_B64}`, alt: "a red cat" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${SECRET}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "gpt-image-1",
      prompt: "a cat",
      n: 1,
      size: "1536x1024",
    });
  });

  test("asks non-gpt-image models for b64_json and detects jpeg", async () => {
    const { calls, impl } = fakeFetch(() => json({ data: [{ b64_json: "/9j/4AAQ" }] }));
    const generate = createImageGenerator({
      listProviders: async () => [provider({ models: ["dall-e-3"] })],
      loadKey: async () => SECRET,
      fetch: impl,
    });
    const result = await generate({ prompt: "x", width: 512, height: 512 });
    expect(result.src.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ response_format: "b64_json" });
  });

  test("local providers work without a key and send no Authorization header", async () => {
    const { calls, impl } = fakeFetch(() => json({ data: [{ b64_json: PNG_B64 }] }));
    const generate = createImageGenerator({
      listProviders: async () => [
        provider({ baseUrl: "http://localhost:1234/v1", models: ["flux-dev"] }),
      ],
      loadKey: async () => null,
      fetch: impl,
    });
    await generate({ prompt: "x", width: 512, height: 512 });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test("errors never contain the API key", async () => {
    const generate = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => SECRET,
      fetch: fakeFetch(() => json({ error: { message: "billing hard limit reached" } }, 400)).impl,
    });
    const error = (await generate({ prompt: "x", width: 512, height: 512 }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(error.message).toMatch(/HTTP 400.*billing hard limit reached/);
    expect(error.message).not.toContain(SECRET);

    const network = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => SECRET,
      fetch: (async () => {
        throw new Error(`boom ${SECRET}`);
      }) as unknown as typeof fetch,
    });
    const networkError = (await network({ prompt: "x", width: 512, height: 512 }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(networkError.message).not.toContain(SECRET);
  });

  test("falls back to a returned url and fails on an empty response", async () => {
    const withUrl = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => SECRET,
      fetch: fakeFetch(() => json({ data: [{ url: "https://cdn.example.com/a.png" }] })).impl,
    });
    expect(await withUrl({ prompt: "x", width: 512, height: 512 })).toEqual({
      src: "https://cdn.example.com/a.png",
    });
    const empty = createImageGenerator({
      listProviders: async () => [provider()],
      loadKey: async () => SECRET,
      fetch: fakeFetch(() => json({ data: [] })).impl,
    });
    await expect(empty({ prompt: "x", width: 512, height: 512 })).rejects.toThrow(/no image/);
  });
});

describe("image model choice", () => {
  const openai = provider();
  const google = provider({
    id: "g1",
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["models/gemini-2.5-flash", "models/gemini-2.5-flash-image", "imagen-4.0-generate-001"],
    createdAt: 2,
  });

  test("every image model of every provider is listed, oldest provider first", () => {
    expect(listImageModels([openai, google]).map(imageModelKey)).toEqual([
      "p1::gpt-image-1",
      "g1::models/gemini-2.5-flash-image",
      "g1::imagen-4.0-generate-001",
    ]);
  });

  test("the picked model wins while it exists; otherwise the first one", () => {
    expect(findImageProvider([openai, google], "g1::imagen-4.0-generate-001")).toMatchObject({
      provider: { id: "g1" },
      model: "imagen-4.0-generate-001",
    });
    expect(findImageProvider([openai, google], "gone::x")?.model).toBe("gpt-image-1");
  });
});

describe("Gemini image models (Nano Banana)", () => {
  const google = provider({
    id: "g1",
    name: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["models/gemini-2.5-flash-image"],
  });

  test("use Google's native endpoint with the key header and the nearest aspect ratio", async () => {
    const { calls, impl } = fakeFetch(() =>
      json({
        candidates: [
          {
            content: {
              parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG_B64 } }],
            },
          },
        ],
      }),
    );
    const generate = createImageGenerator({
      listProviders: async () => [google],
      loadKey: async () => SECRET,
      fetch: impl,
    });
    const result = await generate({ prompt: "rendang on a banana leaf", width: 1600, height: 900 });
    expect(result).toEqual({ src: `data:image/png;base64,${PNG_B64}` });
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(SECRET);
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      contents: [{ parts: [{ text: "rendang on a banana leaf" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    });
  });

  test("a blocked prompt (no image part) and HTTP errors are reported without the key", async () => {
    const empty = createImageGenerator({
      listProviders: async () => [google],
      loadKey: async () => SECRET,
      fetch: fakeFetch(() => json({ candidates: [{ content: { parts: [{ text: "no" }] } }] })).impl,
    });
    await expect(empty({ prompt: "x", width: 512, height: 512 })).rejects.toThrow(
      /returned no image/,
    );
    const denied = createImageGenerator({
      listProviders: async () => [google],
      loadKey: async () => SECRET,
      fetch: fakeFetch(() => json({ error: { message: "API key not valid" } }, 400)).impl,
    });
    const error = await denied({ prompt: "x", width: 512, height: 512 }).catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 400");
    expect(String(error)).not.toContain(SECRET);
  });

  test("aspect ratios and image parts", () => {
    expect(geminiAspectRatio(1024, 1024)).toBe("1:1");
    expect(geminiAspectRatio(1080, 1920)).toBe("9:16");
    expect(geminiAspectRatio(1200, 900)).toBe("4:3");
    expect(
      geminiImage({
        candidates: [
          { content: { parts: [{ inline_data: { data: "AAAA", mimeType: "image/svg+xml" } }] } },
        ],
      }),
    ).toBe("data:image/png;base64,AAAA");
    expect(geminiImage(null)).toBeNull();
  });
});
