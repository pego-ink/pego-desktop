/** API dialect a custom provider speaks. */
export type CustomProviderKind = "openai-compatible" | "anthropic-compatible";

/**
 * A user-added model provider (OpenRouter, DeepSeek, Groq, a local LM Studio/Ollama server,
 * an Anthropic-compatible gateway…). The API key is stored separately (see store.ts).
 */
export type CustomProvider = {
  id: string;
  name: string;
  kind: CustomProviderKind;
  /** Base URL including the version path, e.g. https://api.deepseek.com/v1 or https://host/anthropic. */
  baseUrl: string;
  /** Known model ids (fetched from the provider or typed by the user). */
  models: string[];
  /** Model used for planning; falls back to `executorModel`. */
  plannerModel?: string;
  /** Model that executes steps with the tools (required). */
  executorModel: string;
  createdAt: number;
};
