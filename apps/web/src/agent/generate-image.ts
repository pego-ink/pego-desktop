import type { ToolHost } from "@pego/agent";
import { isLocalBaseUrl } from "./provider-url";
import { listCustomProviders, loadProviderKey } from "./providers/store";
import type { CustomProvider } from "./providers/types";

type GenerateImage = NonNullable<ToolHost["generateImage"]>;

/**
 * Image generation through the user's custom providers.
 *
 * Provider choice (kept simple on purpose): the first, oldest, OpenAI-compatible provider whose
 * `models` list contains an image model id. To enable it, add an OpenAI-compatible provider in
 * Model settings and list an image model (gpt-image-1, dall-e-3, flux..., imagen...) among its
 * models. The request is `POST {baseUrl}/images/generations`. The API key goes only into the
 * Authorization header of that request and is never put in an error message.
 */
export const IMAGE_MODEL_PATTERN = /(^|\/)(gpt-image|dall-e|flux|imagen)/i;

const UNAVAILABLE =
  "Add an OpenAI-compatible provider with an image model in Model settings (for example gpt-image-1 or dall-e-3), then try again.";
const TIMEOUT_MS = 120_000;

/** Thrown when no usable provider exists; the generate_image tool reports it as `unsupported`. */
export class ImageUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUnsupportedError";
  }
}

export const findImageProvider = (
  providers: CustomProvider[],
): { provider: CustomProvider; model: string } | null => {
  for (const provider of providers) {
    if (provider.kind !== "openai-compatible") continue;
    const model = provider.models.find((id) => IMAGE_MODEL_PATTERN.test(id));
    if (model) return { provider, model };
  }
  return null;
};

const nearest = (ratio: number, options: [number, number][]): string => {
  const best = options.reduce((a, b) =>
    Math.abs(Math.log(b[0] / b[1] / ratio)) < Math.abs(Math.log(a[0] / a[1] / ratio)) ? b : a,
  );
  return `${best[0]}x${best[1]}`;
};

/** The size string this model family accepts, closest to the requested aspect ratio. */
export const sizeFor = (model: string, width: number, height: number): string => {
  const ratio = width / height;
  const id = model.toLowerCase();
  if (id.includes("gpt-image")) {
    return nearest(ratio, [
      [1024, 1024],
      [1536, 1024],
      [1024, 1536],
    ]);
  }
  if (id.includes("dall-e-3")) {
    return nearest(ratio, [
      [1024, 1024],
      [1792, 1024],
      [1024, 1792],
    ]);
  }
  if (id.includes("dall-e")) return "1024x1024";
  const snap = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 64) * 64));
  return `${snap(width)}x${snap(height)}`;
};

const MIME_BY_PREFIX: [string, string][] = [
  ["iVBOR", "image/png"],
  ["/9j/", "image/jpeg"],
  ["UklGR", "image/webp"],
  ["R0lGOD", "image/gif"],
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const apiMessage = (body: unknown): string => {
  if (!isRecord(body)) return "";
  const error = body.error;
  const text = typeof error === "string" ? error : isRecord(error) ? error.message : undefined;
  return typeof text === "string" ? `: ${text.slice(0, 200)}` : "";
};

export type GenerateImageDeps = {
  listProviders?: () => Promise<CustomProvider[]>;
  loadKey?: (id: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

/** Build the `ToolHost.generateImage` capability. Dependencies are injectable for tests. */
export const createImageGenerator =
  (deps: GenerateImageDeps = {}): GenerateImage =>
  async ({ prompt, width, height }) => {
    const found = findImageProvider(await (deps.listProviders ?? listCustomProviders)());
    if (!found) throw new ImageUnsupportedError(UNAVAILABLE);
    const { provider, model } = found;
    const key = await (deps.loadKey ?? loadProviderKey)(provider.id);
    if (!key && !isLocalBaseUrl(provider.baseUrl)) {
      throw new ImageUnsupportedError(
        `No API key saved for ${provider.name}. Add it in Model settings, then try again.`,
      );
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: sizeFor(model, width, height),
      // gpt-image models always return base64 and reject this parameter.
      ...(model.toLowerCase().includes("gpt-image") ? {} : { response_format: "b64_json" }),
    };

    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(`${provider.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error(`Could not reach ${provider.name} for image generation.`);
    }

    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `${provider.name} returned HTTP ${response.status} for image generation${apiMessage(json)}`,
      );
    }
    const first = isRecord(json) && Array.isArray(json.data) ? json.data[0] : undefined;
    const b64 = isRecord(first) && typeof first.b64_json === "string" ? first.b64_json : "";
    if (isRecord(first) && b64.length > 0) {
      const mime = MIME_BY_PREFIX.find(([prefix]) => b64.startsWith(prefix));
      const alt = typeof first.revised_prompt === "string" ? first.revised_prompt : undefined;
      return {
        src: `data:${mime?.[1] ?? "image/png"};base64,${b64}`,
        ...(alt ? { alt: alt.slice(0, 200) } : {}),
      };
    }
    if (isRecord(first) && typeof first.url === "string") return { src: first.url };
    throw new Error(`${provider.name} returned no image.`);
  };

export const generateImage: GenerateImage = createImageGenerator();
