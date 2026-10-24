import { listImageModels } from "@/agent/generate-image";
import { isLocalBaseUrl } from "@/agent/provider-url";
import { listCustomProviders, loadProviderKey } from "@/agent/providers/store";
import type { CustomProvider } from "@/agent/providers/types";

/**
 * High-quality background removal through the user's own image model. Only OpenAI's gpt-image
 * models can answer with a transparent background (`background: "transparent"` on
 * /images/edits); other image models cannot, so they are not offered.
 */

export const TRANSPARENT_IMAGE_MODEL = /(^|\/)gpt-image/i;
const TIMEOUT_MS = 180_000;
const PROMPT =
  "Remove the background completely. Keep the main subject exactly as it is (shape, colors, details), with clean edges, on a transparent background.";

/** The first provider model that can return a transparent background, or null. */
export const findTransparentModel = (
  providers: CustomProvider[],
): { provider: CustomProvider; model: string } | null => {
  const choice = listImageModels(providers).find((c) => TRANSPARENT_IMAGE_MODEL.test(c.model));
  const provider = choice && providers.find((p) => p.id === choice.providerId);
  return choice && provider ? { provider, model: choice.model } : null;
};

export type ProviderDeps = {
  listProviders?: () => Promise<CustomProvider[]>;
  loadKey?: (id: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

/** Whether high-quality removal is available (a gpt-image model in the user's providers). */
export const providerRemovalAvailable = async (deps: ProviderDeps = {}): Promise<boolean> =>
  findTransparentModel(await (deps.listProviders ?? listCustomProviders)()) !== null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** `png` with its background removed by the provider, as a PNG data URL. Rejects with a message. */
export const removeBackgroundWithProvider = async (
  png: Blob,
  deps: ProviderDeps = {},
): Promise<string> => {
  const found = findTransparentModel(await (deps.listProviders ?? listCustomProviders)());
  if (!found) {
    throw new Error(
      "High quality needs an OpenAI-compatible provider with a gpt-image model (Model settings).",
    );
  }
  const { provider, model } = found;
  const key = await (deps.loadKey ?? loadProviderKey)(provider.id);
  if (!key && !isLocalBaseUrl(provider.baseUrl)) {
    throw new Error(`No API key saved for ${provider.name}. Add it in Model settings.`);
  }
  const form = new FormData();
  form.append("model", model);
  form.append("image", png, "image.png");
  form.append("prompt", PROMPT);
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("n", "1");
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${provider.baseUrl}/images/edits`, {
      method: "POST",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Could not reach ${provider.name} to remove the background.`);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
        ? `: ${json.error.message.slice(0, 200)}`
        : "";
    throw new Error(`${provider.name} returned HTTP ${response.status}${detail}`);
  }
  const first = isRecord(json) && Array.isArray(json.data) ? json.data[0] : undefined;
  const b64 = isRecord(first) && typeof first.b64_json === "string" ? first.b64_json : "";
  if (!b64) throw new Error(`${provider.name} returned no image.`);
  return `data:image/png;base64,${b64}`;
};
