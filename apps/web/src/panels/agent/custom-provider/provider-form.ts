import { baseUrlHost, checkBaseUrl, isLocalBaseUrl } from "@/agent/provider-url";
import type { CustomProvider, CustomProviderKind } from "@/agent/providers/types";

/** Pure helpers behind the custom-provider form and lists (no React, no storage). */

export const KIND_LABEL: Record<CustomProviderKind, string> = {
  "openai-compatible": "OpenAI-compatible",
  "anthropic-compatible": "Anthropic-compatible",
};

export const KIND_OPTIONS = [
  { value: "openai-compatible", label: "OpenAI" },
  { value: "anthropic-compatible", label: "Anthropic" },
] as const satisfies readonly { value: CustomProviderKind; label: string }[];

export type ProviderPreset = {
  id: string;
  label: string;
  kind: CustomProviderKind;
  baseUrl: string;
};

/** Shortcuts for the base URL field. Picking one fills the name too when it is still empty. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "together",
    label: "Together",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai-compatible",
    // Chat models, Imagen and Gemini image models ("Nano Banana") on one key from AI Studio.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
  },
];

export const BASE_URL_PLACEHOLDER: Record<CustomProviderKind, string> = {
  "openai-compatible": "https://api.example.com/v1",
  "anthropic-compatible": "https://gateway.example.com/anthropic",
};

export type ProviderDraft = {
  name: string;
  kind: CustomProviderKind;
  baseUrl: string;
  /** Typed key. Empty while editing means "keep the saved key". */
  apiKey: string;
  /** Ids fetched from the provider or kept from the saved provider. */
  models: string[];
  executorModel: string;
  plannerModel: string;
};

export const emptyDraft = (): ProviderDraft => ({
  name: "",
  kind: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  models: [],
  executorModel: "",
  plannerModel: "",
});

export const draftFromProvider = (provider: CustomProvider): ProviderDraft => ({
  name: provider.name,
  kind: provider.kind,
  baseUrl: provider.baseUrl,
  apiKey: "",
  models: provider.models,
  executorModel: provider.executorModel,
  plannerModel: provider.plannerModel ?? "",
});

export type DraftField = "name" | "baseUrl" | "apiKey" | "executorModel" | "plannerModel";
export type DraftErrors = Partial<Record<DraftField, string>>;

const MAX_NAME = 60;
const MAX_MODEL_ID = 200;

/** Model ids are opaque to Pego, but whitespace/control characters never belong in one. */
export const isValidModelId = (id: string): boolean =>
  id.length > 0 &&
  id.length <= MAX_MODEL_ID &&
  ![...id].some((char) => /\s/.test(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

/** Trim, drop empties and duplicates, keep first-seen order. */
export const mergeModels = (...lists: readonly (readonly string[])[]): string[] => {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const id = raw.trim();
      if (id) seen.add(id);
    }
  }
  return [...seen];
};

export type ValidateOptions = {
  /** Editing a provider that already has a key saved. */
  hasSavedKey: boolean;
};

export type ValidationResult =
  | { ok: true; value: Omit<CustomProvider, "id" | "createdAt"> }
  | { ok: false; errors: DraftErrors };

/** Check the form. On success returns the provider fields (cleaned URL, merged model list). */
export const validateDraft = (draft: ProviderDraft, options: ValidateOptions): ValidationResult => {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter a name.";
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;

  const url = checkBaseUrl(draft.baseUrl);
  if ("error" in url) errors.baseUrl = url.error;

  const needsKey = draft.baseUrl.trim() !== "" && !isLocalBaseUrl(draft.baseUrl);
  if (needsKey && !draft.apiKey.trim() && !options.hasSavedKey) {
    errors.apiKey = "Enter the API key. Only localhost providers can skip it.";
  }

  const executor = draft.executorModel.trim();
  if (!executor) errors.executorModel = "Choose or type the model that runs the steps.";
  else if (!isValidModelId(executor)) errors.executorModel = "Model ids cannot contain spaces.";

  const planner = draft.plannerModel.trim();
  if (planner && !isValidModelId(planner)) errors.plannerModel = "Model ids cannot contain spaces.";

  if (Object.keys(errors).length > 0 || "error" in url) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      kind: draft.kind,
      baseUrl: url.url,
      models: mergeModels(draft.models, [executor], planner ? [planner] : []).filter(
        isValidModelId,
      ),
      executorModel: executor,
      ...(planner ? { plannerModel: planner } : {}),
    },
  };
};

/** Row summary: "api.deepseek.com · 3 models". */
export const providerSummary = (provider: CustomProvider): string => {
  const count = provider.models.length;
  return `${baseUrlHost(provider.baseUrl)} · ${count} ${count === 1 ? "model" : "models"}`;
};

/** The provider with a new executor model (also remembered in its model list). */
export const withExecutorModel = (provider: CustomProvider, model: string): CustomProvider => ({
  ...provider,
  executorModel: model,
  models: mergeModels(provider.models, [model]),
});

/**
 * The persisted selection points at a provider that was deleted (or never loaded): say which
 * backend to fall back to. Null while the selection is fine or not a custom one.
 */
export const staleCustomSelection = (
  backend: string,
  providerId: string | null,
  providers: readonly CustomProvider[],
): "local" | null =>
  backend === "custom" && !providers.some((p) => p.id === providerId) ? "local" : null;
