/** USD per million tokens. Cache reads/writes per the Claude API pricing for each model. */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Refusal-fallback targets (`fallbacks: "default"` may serve a turn on one of them).
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type MessageUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

const priceFor = (model: string, requestedModel: string): Price | undefined =>
  PRICES[model] ?? PRICES[requestedModel];

/** Usage delta for the store: total input includes cache reads and writes. */
export const toUsageDelta = (usage: MessageUsage, servedModel: string, requestedModel: string) => {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const price = priceFor(servedModel, requestedModel);
  const costUsd = price
    ? (usage.input_tokens * price.input +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite +
        usage.output_tokens * price.output) /
      1_000_000
    : 0;
  return {
    inputTokens: usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: usage.output_tokens,
    costUsd,
  };
};
