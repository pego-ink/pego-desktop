import type { CustomProviderKind } from "./types";

const TIMEOUT_MS = 15_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Endpoint URL + headers per dialect. The key only ever goes into a header. */
const modelsRequest = (
  kind: CustomProviderKind,
  baseUrl: string,
  apiKey: string,
): { url: string; headers: Record<string, string> } => {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (kind === "openai-compatible") {
    return {
      url: `${base}/models`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    };
  }
  return {
    // Anthropic pages at 20 by default; ask for the maximum.
    url: `${base.endsWith("/v1") ? base : `${base}/v1`}/models?limit=1000`,
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  };
};

/** Pull ids from `{data: [{id}]}` (OpenAI/Anthropic), `{models: [...]}` or a bare array. */
const extractIds = (body: unknown): string[] => {
  const list = Array.isArray(body)
    ? body
    : isRecord(body)
      ? Array.isArray(body.data)
        ? body.data
        : Array.isArray(body.models)
          ? body.models
          : []
      : [];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!isRecord(entry)) return [];
    const id = entry.id ?? entry.name;
    return typeof id === "string" && id.length > 0 ? [id] : [];
  });
};

const statusMessage = (status: number): string => {
  if (status === 401 || status === 403) {
    return "The provider rejected the API key (HTTP " + status + "). Check the key.";
  }
  if (status === 404) {
    return "The provider has no models endpoint at this base URL (HTTP 404). Check the base URL, or type the model id by hand.";
  }
  if (status === 429)
    return "The provider is rate limiting requests (HTTP 429). Try again shortly.";
  if (status >= 500) return `The provider failed (HTTP ${status}). Try again shortly.`;
  return `The provider returned HTTP ${status}.`;
};

/**
 * List model ids from the provider. Returns sorted unique ids; throws a readable Error (never
 * containing the key) on failure.
 */
export const fetchProviderModels = async (
  kind: CustomProviderKind,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const { url, headers } = modelsRequest(kind, baseUrl, apiKey.trim());
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted)
      throw new Error("The provider did not answer in time. Try again.", { cause: error });
    // A blocked cross-origin request surfaces as a bare TypeError, same as an unreachable host.
    throw new Error(
      "The provider blocked a browser request (CORS) or could not be reached. " +
        "Check the base URL; providers without browser CORS support cannot be used from Pego.",
      { cause: error },
    );
  }
  if (!response.ok) throw new Error(statusMessage(response.status));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The provider returned a models list that could not be read.");
  }
  const ids = [...new Set(extractIds(body))].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) throw new Error("The provider returned no models.");
  return ids;
};
