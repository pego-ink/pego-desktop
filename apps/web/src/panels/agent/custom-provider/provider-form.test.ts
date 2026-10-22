/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { checkBaseUrl, isLocalBaseUrl } from "@/agent/provider-url";
import type { CustomProvider } from "@/agent/providers/types";
import {
  emptyDraft,
  isValidModelId,
  mergeModels,
  PROVIDER_PRESETS,
  providerSummary,
  staleCustomSelection,
  validateDraft,
  withExecutorModel,
  type ProviderDraft,
} from "./provider-form";

const draft = (over: Partial<ProviderDraft> = {}): ProviderDraft => ({
  ...emptyDraft(),
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1/",
  apiKey: "sk-test",
  executorModel: "deepseek-chat",
  ...over,
});

describe("validateDraft", () => {
  test("a complete draft is cleaned and keeps executor/planner in the model list", () => {
    const result = validateDraft(draft({ plannerModel: "deepseek-reasoner", models: ["a", "a"] }), {
      hasSavedKey: false,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "DeepSeek",
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        models: ["a", "deepseek-chat", "deepseek-reasoner"],
        executorModel: "deepseek-chat",
        plannerModel: "deepseek-reasoner",
      },
    });
  });

  test("planner stays unset when empty", () => {
    const result = validateDraft(draft(), { hasSavedKey: false });
    expect(result.ok && "plannerModel" in result.value).toBe(false);
  });

  test("required fields are reported together", () => {
    const result = validateDraft(emptyDraft(), { hasSavedKey: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["baseUrl", "executorModel", "name"]);
  });

  test("remote providers need a key unless one is already saved", () => {
    const missing = validateDraft(draft({ apiKey: " " }), { hasSavedKey: false });
    expect(!missing.ok && missing.errors.apiKey).toBeTruthy();
    expect(validateDraft(draft({ apiKey: "" }), { hasSavedKey: true }).ok).toBe(true);
  });

  test("localhost providers may skip the key", () => {
    const result = validateDraft(draft({ baseUrl: "http://localhost:11434/v1", apiKey: "" }), {
      hasSavedKey: false,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects model ids with spaces", () => {
    const result = validateDraft(draft({ executorModel: "my model" }), { hasSavedKey: false });
    expect(!result.ok && result.errors.executorModel).toBeTruthy();
  });
});

describe("base URL checks", () => {
  test("https and localhost http pass; remote http, junk and credentials fail", () => {
    expect(checkBaseUrl("https://openrouter.ai/api/v1")).toEqual({
      url: "https://openrouter.ai/api/v1",
    });
    expect(checkBaseUrl("http://127.0.0.1:1234/v1/")).toEqual({ url: "http://127.0.0.1:1234/v1" });
    expect("error" in checkBaseUrl("http://example.com/v1")).toBe(true);
    expect("error" in checkBaseUrl("ftp://example.com")).toBe(true);
    expect("error" in checkBaseUrl("not a url")).toBe(true);
    expect("error" in checkBaseUrl("https://user:pw@example.com/v1")).toBe(true);
    expect("error" in checkBaseUrl("")).toBe(true);
  });

  test("every preset is a valid base URL", () => {
    for (const preset of PROVIDER_PRESETS) expect("url" in checkBaseUrl(preset.baseUrl)).toBe(true);
  });

  test("isLocalBaseUrl", () => {
    expect(isLocalBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:1234")).toBe(true);
    expect(isLocalBaseUrl("https://localhost.evil.com/v1")).toBe(false);
    expect(isLocalBaseUrl("nope")).toBe(false);
  });
});

describe("models and summaries", () => {
  const provider: CustomProvider = {
    id: "p",
    name: "P",
    kind: "anthropic-compatible",
    baseUrl: "https://gw.example.com:8443/anthropic",
    models: ["a"],
    executorModel: "a",
    createdAt: 1,
  };

  test("mergeModels trims, dedupes and keeps order", () => {
    expect(mergeModels([" a", "b"], ["a", "", "c"])).toEqual(["a", "b", "c"]);
  });

  test("isValidModelId", () => {
    expect(isValidModelId("deepseek/deepseek-chat:free")).toBe(true);
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId("a b")).toBe(false);
  });

  test("providerSummary shows host and a pluralised model count", () => {
    expect(providerSummary(provider)).toBe("gw.example.com:8443 · 1 model");
    expect(providerSummary({ ...provider, models: ["a", "b"] })).toContain("2 models");
  });

  test("withExecutorModel sets the executor and remembers it", () => {
    expect(withExecutorModel(provider, "z")).toMatchObject({
      executorModel: "z",
      models: ["a", "z"],
    });
  });

  test("staleCustomSelection flags a deleted provider only", () => {
    expect(staleCustomSelection("custom", "gone", [provider])).toBe("local");
    expect(staleCustomSelection("custom", "p", [provider])).toBeNull();
    expect(staleCustomSelection("local", "gone", [])).toBeNull();
  });
});
