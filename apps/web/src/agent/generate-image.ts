import type { ToolHost } from "@pego/agent";
import { baseUrlHost, isLocalBaseUrl } from "./provider-url";
import { listCustomProviders, loadProviderKey } from "./providers/store";
import type { CustomProvider } from "./providers/types";
import { readPreferredImageModel } from "@/images/image-model-store";

type GenerateImage = NonNullable<ToolHost["generateImage"]>;

/**
 * Image generation through the user's custom providers.
 *
 * Provider choice: the image model the user picked (Assets › Images › Generate), else the first,
 * oldest, OpenAI-compatible provider whose `models` list contains an image model id. To enable it,
 * add an OpenAI-compatible provider in Model settings and list an image model (gpt-image-1,
 * dall-e-3, flux..., imagen..., or Google's gemini-2.5-flash-image "Nano Banana") among its
 * models. The request is `POST {baseUrl}/images/generations`, except for Gemini image models on
 * Google's API, which use its native `generateContent`. The API key goes only into the request's
 * auth header and is never put in an error message.
 */
export const IMAGE_MODEL_PATTERN =
  /(^|\/)(gpt-image|dall-e|flux|imagen|gemini-[\w.-]*image|nano-banana)/i;

/** Google's Generative Language API (its OpenAI-compatible base is .../v1beta/openai). */
const GOOGLE_API_HOST = "generativelanguage.googleapis.com";

/** One image model the user can generate with. */
export type ImageModelChoice = { providerId: string; providerName: string; model: string };

/** Key of a choice, as stored for the user's pick. */
export const imageModelKey = (choice: Pick<ImageModelChoice, "providerId" | "model">) =>
  `${choice.providerId}::${choice.model}`;

/** Every image model of every OpenAI-compatible provider, oldest provider first. */
export const listImageModels = (providers: CustomProvider[]): ImageModelChoice[] =>
  providers.flatMap((provider) =>
    provider.kind === "openai-compatible"
      ? provider.models
          .filter((id) => IMAGE_MODEL_PATTERN.test(id))
          .map((model) => ({ providerId: provider.id, providerName: provider.name, model }))
      : [],
  );

/** A Gemini image model on Google's API: generated through the native endpoint. */
export const isGeminiImageModel = (provider: Pick<CustomProvider, "baseUrl">, model: string) =>
  baseUrlHost(provider.baseUrl) === GOOGLE_API_HOST && /gemini|nano-banana/i.test(model);

const GEMINI_RATIOS: [number, number][] = [
  [1, 1],
  [2, 3],
  [3, 2],
  [3, 4],
  [4, 3],
  [4, 5],
  [5, 4],
  [9, 16],
  [16, 9],
  [21, 9],
];

/** The aspect ratio Gemini accepts that is closest to width / height, e.g. "16:9". */
export const geminiAspectRatio = (width: number, height: number): string => {
  const ratio = width / height;
  const best = GEMINI_RATIOS.reduce((a, b) =>
    Math.abs(Math.log(b[0] / b[1] / ratio)) < Math.abs(Math.log(a[0] / a[1] / ratio)) ? b : a,
  );
  return `${best[0]}:${best[1]}`;
};

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

/** The provider and model to generate with: the preferred choice when it still exists. */
export const findImageProvider = (
  providers: CustomProvider[],
  preferred: string | null = null,
): { provider: CustomProvider; model: string } | null => {
  const choices = listImageModels(providers);
  const choice = choices.find((c) => imageModelKey(c) === preferred) ?? choices[0];
  const provider = choice && providers.find((p) => p.id === choice.providerId);
  return choice && provider ? { provider, model: choice.model } : null;
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
  /** The user's picked image model (`imageModelKey`), if any. */
  preferredModel?: () => string | null;
};

/** The image of a Gemini `generateContent` answer as a data URL, or null. */
export const geminiImage = (body: unknown): string | null => {
  const candidates = isRecord(body) && Array.isArray(body.candidates) ? body.candidates : [];
  for (const candidate of candidates) {
    const content = isRecord(candidate) ? candidate.content : undefined;
    const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      const inline = isRecord(part) ? (part.inlineData ?? part.inline_data) : undefined;
      if (!isRecord(inline) || typeof inline.data !== "string" || inline.data.length === 0)
        continue;
      const mime =
        typeof inline.mimeType === "string" && /^image\/(png|jpeg|webp)$/.test(inline.mimeType)
          ? inline.mimeType
          : "image/png";
      return `data:${mime};base64,${inline.data}`;
    }
  }
  return null;
};

/** Build the `ToolHost.generateImage` capability. Dependencies are injectable for tests. */
export const createImageGenerator =
  (deps: GenerateImageDeps = {}): GenerateImage =>
  async ({ prompt, width, height }) => {
    const found = findImageProvider(
      await (deps.listProviders ?? listCustomProviders)(),
      (deps.preferredModel ?? (() => null))(),
    );
    if (!found) throw new ImageUnsupportedError(UNAVAILABLE);
    const { provider, model } = found;
    const key = await (deps.loadKey ?? loadProviderKey)(provider.id);
    if (!key && !isLocalBaseUrl(provider.baseUrl)) {
      throw new ImageUnsupportedError(
        `No API key saved for ${provider.name}. Add it in Model settings, then try again.`,
      );
    }

    if (isGeminiImageModel(provider, model)) {
      // Google's native endpoint: the base URL's origin plus /v1beta/models/<model>.
      const origin = new URL(provider.baseUrl).origin;
      const id = model.replace(/^models\//, "");
      let response: Response;
      try {
        response = await (deps.fetch ?? fetch)(
          `${origin}/v1beta/models/${encodeURIComponent(id)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(key ? { "x-goog-api-key": key } : {}),
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: geminiAspectRatio(width, height) },
              },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch {
        throw new Error(`Could not reach ${provider.name} for image generation.`);
      }
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `${provider.name} returned HTTP ${response.status} for image generation${apiMessage(json)}`,
        );
      }
      const src = geminiImage(json);
      if (!src) throw new Error(`${provider.name} returned no image (the prompt may be blocked).`);
      return { src };
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

export const generateImage: GenerateImage = createImageGenerator({
  preferredModel: () => readPreferredImageModel(),
});
