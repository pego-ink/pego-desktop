/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  createMemoryBackend,
  deleteCustomProvider,
  listCustomProviders,
  loadProviderKey,
  normalizeBaseUrl,
  saveCustomProvider,
  saveProviderKey,
  setStoreBackend,
} from "./store";
import type { CustomProvider } from "./types";

const provider = (over: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "p1",
  name: "DeepSeek",
  kind: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1/",
  models: ["deepseek-chat", "deepseek-chat", " "],
  executorModel: "deepseek-chat",
  createdAt: 1,
  ...over,
});

beforeEach(() => setStoreBackend(createMemoryBackend()));

describe("validation", () => {
  test("requires https except for localhost and 127.0.0.1", () => {
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
    expect(normalizeBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
    expect(() => normalizeBaseUrl("http://example.com/v1")).toThrow(/https/);
    expect(() => normalizeBaseUrl("http://localhost.evil.com/v1")).toThrow(/https/);
    expect(() => normalizeBaseUrl("ftp://example.com")).toThrow(/https/);
    expect(() => normalizeBaseUrl("not a url")).toThrow(/valid URL/);
    expect(() => normalizeBaseUrl("https://user:pw@example.com/v1")).toThrow(/credentials/);
  });

  test("rejects an empty name or executor model and a bad kind", async () => {
    await expect(saveCustomProvider(provider({ name: "  " }))).rejects.toThrow(/Name/);
    await expect(saveCustomProvider(provider({ executorModel: "" }))).rejects.toThrow(/Executor/);
    await expect(
      saveCustomProvider(provider({ kind: "other" as CustomProvider["kind"] })),
    ).rejects.toThrow(/kind/);
    await expect(saveCustomProvider(provider({ baseUrl: "http://example.com" }))).rejects.toThrow();
    expect(await listCustomProviders()).toEqual([]);
  });
});

describe("persistence", () => {
  test("saves normalized, lists oldest first, upserts and deletes with the key", async () => {
    await saveCustomProvider(provider({ id: "b", createdAt: 2 }));
    await saveCustomProvider(provider({ id: "a", createdAt: 1, plannerModel: " big " }));
    await saveProviderKey("a", "  sk-secret ");
    const [first, second] = await listCustomProviders();
    expect(first).toMatchObject({
      id: "a",
      baseUrl: "https://api.deepseek.com/v1",
      models: ["deepseek-chat"],
      plannerModel: "big",
    });
    expect(second?.id).toBe("b");
    expect(await loadProviderKey("a")).toBe("sk-secret");

    await saveCustomProvider(provider({ id: "a", name: "Renamed", createdAt: 1 }));
    expect((await listCustomProviders())[0]?.name).toBe("Renamed");

    await deleteCustomProvider("a");
    expect((await listCustomProviders()).map((p) => p.id)).toEqual(["b"]);
    expect(await loadProviderKey("a")).toBeNull();
  });

  test("an empty key removes it", async () => {
    await saveProviderKey("p1", "k");
    await saveProviderKey("p1", "");
    expect(await loadProviderKey("p1")).toBeNull();
  });
});
