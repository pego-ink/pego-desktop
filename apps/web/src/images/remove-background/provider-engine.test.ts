import { describe, expect, test } from "bun:test";
import type { CustomProvider } from "@/agent/providers/types";
import { findTransparentModel, removeBackgroundWithProvider } from "./provider-engine";

const provider = (patch: Partial<CustomProvider>): CustomProvider => ({
  id: "p",
  name: "OpenAI",
  kind: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  models: [],
  executorModel: "gpt-4o",
  createdAt: 0,
  ...patch,
});

describe("findTransparentModel", () => {
  test("only gpt-image models qualify (they can return transparency)", () => {
    const gemini = provider({
      id: "g",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      models: ["gemini-2.5-flash-image"],
    });
    const dalle = provider({ id: "d", models: ["dall-e-3"] });
    expect(findTransparentModel([gemini, dalle])).toBeNull();
    const openai = provider({ id: "o", models: ["dall-e-3", "gpt-image-1"] });
    expect(findTransparentModel([gemini, openai])).toMatchObject({ model: "gpt-image-1" });
  });
});

describe("removeBackgroundWithProvider", () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const deps = (respond: (request: { url: string; init: RequestInit }) => Response) => {
    const requests: { url: string; init: RequestInit }[] = [];
    return {
      requests,
      deps: {
        listProviders: async () => [provider({ models: ["gpt-image-1"] })],
        loadKey: async () => "sk-test",
        fetch: (async (url: string, init: RequestInit) => {
          requests.push({ url, init });
          return respond({ url, init });
        }) as unknown as typeof fetch,
      },
    };
  };

  test("asks /images/edits for a transparent PNG and returns it as a data URL", async () => {
    const { requests, deps: d } = deps(() =>
      Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
    );
    expect(await removeBackgroundWithProvider(png, d)).toBe("data:image/png;base64,iVBORw0KGgo=");
    const [request] = requests;
    expect(request!.url).toBe("https://api.openai.com/v1/images/edits");
    expect((request!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = request!.init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1");
    expect(form.get("background")).toBe("transparent");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  test("a base URL with a trailing slash gets no double slash", async () => {
    const { requests, deps: d } = deps(() =>
      Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
    );
    d.listProviders = async () => [
      provider({ baseUrl: "https://api.openai.com/v1/", models: ["gpt-image-1"] }),
    ];
    await removeBackgroundWithProvider(png, d);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/images/edits");
  });

  test("an API error is a readable message", async () => {
    const { deps: d } = deps(() =>
      Response.json({ error: { message: "Billing limit reached" } }, { status: 429 }),
    );
    expect(removeBackgroundWithProvider(png, d)).rejects.toThrow(
      "OpenAI returned HTTP 429: Billing limit reached",
    );
  });

  test("without a gpt-image model or a key it says what to set up", async () => {
    expect(
      removeBackgroundWithProvider(png, {
        listProviders: async () => [provider({ models: ["dall-e-3"] })],
      }),
    ).rejects.toThrow(/gpt-image/);
    expect(
      removeBackgroundWithProvider(png, {
        listProviders: async () => [provider({ models: ["gpt-image-1"] })],
        loadKey: async () => null,
      }),
    ).rejects.toThrow(/No API key/);
  });
});
