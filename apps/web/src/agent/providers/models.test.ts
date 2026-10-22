/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { fetchProviderModels } from "./models";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; headers: Record<string, string> };

const mockFetch = (respond: () => Response | Error) => {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: init?.headers as Record<string, string> });
    const reply = respond();
    if (reply instanceof Error) throw reply;
    return reply;
  }) as unknown as typeof fetch;
  return seen;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchProviderModels", () => {
  test("openai-compatible: GET /models with a bearer token, sorted and unique", async () => {
    const seen = mockFetch(() => json({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] }));
    expect(await fetchProviderModels("openai-compatible", "https://x.test/v1/", "sk-1")).toEqual([
      "a",
      "b",
    ]);
    expect(seen[0]?.url).toBe("https://x.test/v1/models");
    expect(seen[0]?.headers.Authorization).toBe("Bearer sk-1");
  });

  test("anthropic-compatible: /v1/models, or /models when the base already ends in /v1", async () => {
    const seen = mockFetch(() => json({ data: [{ id: "claude-x" }] }));
    await fetchProviderModels("anthropic-compatible", "https://gw.test/anthropic", "k");
    await fetchProviderModels("anthropic-compatible", "https://gw.test/v1", "k");
    expect(seen[0]?.url).toStartWith("https://gw.test/anthropic/v1/models");
    expect(seen[1]?.url).toStartWith("https://gw.test/v1/models");
    expect(seen[0]?.headers).toMatchObject({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  test("maps 401, 404 and network failures to readable errors without the key", async () => {
    mockFetch(() => json({}, 401));
    await expect(
      fetchProviderModels("openai-compatible", "https://x.test/v1", "sk-9"),
    ).rejects.toThrow(/rejected the API key/);
    mockFetch(() => json({}, 404));
    await expect(
      fetchProviderModels("openai-compatible", "https://x.test/v1", "sk-9"),
    ).rejects.toThrow(/404/);
    mockFetch(() => new TypeError("Failed to fetch"));
    const error = await fetchProviderModels("openai-compatible", "https://x.test/v1", "sk-9").catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toContain("blocked a browser request (CORS)");
    expect((error as Error).message).not.toContain("sk-9");
  });

  test("rejects an empty or unreadable list", async () => {
    mockFetch(() => json({ data: [] }));
    await expect(fetchProviderModels("openai-compatible", "https://x.test/v1", "")).rejects.toThrow(
      /no models/,
    );
    mockFetch(() => new Response("<html>", { status: 200 }));
    await expect(fetchProviderModels("openai-compatible", "https://x.test/v1", "")).rejects.toThrow(
      /could not be read/,
    );
  });
});
