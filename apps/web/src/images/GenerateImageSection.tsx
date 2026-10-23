import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { Spinner } from "@pego/ui/components/spinner";
import { Textarea } from "@pego/ui/components/textarea";
import { generateImage, imageModelKey, listImageModels } from "@/agent/generate-image";
import { useCustomProvidersStore } from "@/panels/agent/custom-provider/use-custom-providers";
import { useSettingsModal } from "@/store/use-settings-store";
import { useImageModelStore } from "./image-model-store";
import { GENERATED_IMAGE_MIME, placeImageLayer } from "./stock-image";

/** Shapes to generate in: the request size (the model snaps it) and the label. */
const SHAPES = [
  { id: "square", label: "Square 1:1", width: 1024, height: 1024 },
  { id: "landscape", label: "Landscape 4:3", width: 1024, height: 768 },
  { id: "wide", label: "Wide 16:9", width: 1600, height: 900 },
  { id: "portrait", label: "Portrait 3:4", width: 768, height: 1024 },
  { id: "tall", label: "Tall 9:16", width: 900, height: 1600 },
] as const;

type Generated = { src: string; prompt: string; width: number; height: number };

const place = (image: Generated, screen?: { x: number; y: number }) =>
  placeImageLayer({ src: image.src, name: "Generated image", alt: image.prompt }, image, screen);

/**
 * Assets › Images › Generate: make an image from a prompt with the user's image model (an
 * OpenAI-compatible provider with gpt-image, DALL·E, Imagen, Flux, or Google's Gemini image model
 * "Nano Banana"), placed in the middle of the view. Earlier results stay to place again.
 */
export const GenerateImageSection = () => {
  const providers = useCustomProvidersStore((s) => s.providers);
  const loaded = useCustomProvidersStore((s) => s.loaded);
  const preferred = useImageModelStore((s) => s.preferred);
  const setPreferred = useImageModelStore((s) => s.setPreferred);
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState<(typeof SHAPES)[number]["id"]>("landscape");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Generated[]>([]);

  useEffect(() => {
    if (!loaded) void useCustomProvidersStore.getState().refresh();
  }, [loaded]);

  const models = useMemo(() => listImageModels(providers), [providers]);
  const current = models.find((choice) => imageModelKey(choice) === preferred) ?? models[0] ?? null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    const size = SHAPES.find((s) => s.id === shape) ?? SHAPES[1];
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { src, alt } = await generateImage({
        prompt: text,
        width: size.width,
        height: size.height,
      });
      const image = { src, prompt: alt ?? text, width: size.width, height: size.height };
      setResults((list) => [image, ...list].slice(0, 12));
      place(image);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The image could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  if (loaded && models.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-3 pb-3 text-[11px] leading-4 text-muted-foreground">
        <p>
          Generating images needs an image model. Add a provider in Settings › Agent &amp; Models:
          for example Google Gemini (its &quot;Nano Banana&quot; model, gemini-2.5-flash-image) or
          OpenAI (gpt-image-1), with your own API key.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => useSettingsModal.getState().openSettings("agent", "add-provider")}
        >
          Add an image model
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-2 px-3 pb-3">
        <Textarea
          value={prompt}
          placeholder="Describe the image: subject, setting, light, mood. E.g. rendang on a banana leaf, warm window light"
          aria-label="Image prompt"
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              void onSubmit(event as unknown as FormEvent);
          }}
          className="min-h-20 text-xs"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <NativeSelect
            aria-label="Image shape"
            value={shape}
            onChange={(event) => setShape(event.target.value as typeof shape)}
          >
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Image model"
            value={current ? imageModelKey(current) : ""}
            onChange={(event) => setPreferred(event.target.value || null)}
            disabled={models.length < 2}
          >
            {models.map((choice) => (
              <option key={imageModelKey(choice)} value={imageModelKey(choice)}>
                {choice.providerName} · {choice.model.replace(/^models\//, "")}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" disabled={busy || !prompt.trim() || !current}>
          {busy ? <Spinner className="size-3" /> : <SparklesIcon />}
          {busy ? "Generating…" : "Generate"}
        </Button>
        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-destructive">
            {error}
          </p>
        ) : null}
      </form>
      {results.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 pt-2 pb-3">
          <div className="pb-1.5 text-[11px] text-muted-foreground">
            Recent: click to place again, or drag onto the canvas
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {results.map((image, index) => (
              <button
                key={index}
                type="button"
                draggable
                title={image.prompt}
                aria-label={`Place generated image: ${image.prompt}`}
                onClick={() => place(image)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(GENERATED_IMAGE_MIME, JSON.stringify(image));
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="aspect-square overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <img
                  src={image.src}
                  alt={image.prompt}
                  draggable={false}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
