import { useEffect, useState } from "react";
import { ScissorsIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@pego/ui/components/button";
import { Spinner } from "@pego/ui/components/spinner";
import { PropertyRow } from "@pego/ui/components/property-section";
import {
  BACKGROUND_MODEL,
  modelIsCached,
  providerRemovalAvailable,
  removeBackground,
  type RemovalQuality,
} from "./index";

/**
 * Remove the background of an image (an image layer or an image fill), with a toast for the
 * progress: the one-time model download on the device, or the provider request.
 */
export const removeBackgroundWithProgress = async (
  src: string,
  quality: RemovalQuality,
  options: { rethrow?: boolean } = {},
): Promise<string | null> => {
  const firstRun = quality === "standard" && !(await modelIsCached());
  const megabytes = Math.round(BACKGROUND_MODEL.bytes / 1_000_000);
  const progress = toast.loading(
    firstRun
      ? `Downloading the background model (${megabytes} MB, once)…`
      : quality === "high"
        ? "Removing the background with your image model…"
        : "Removing the background…",
  );
  try {
    const result = await removeBackground(src, quality, (loaded, total) => {
      const percent = Math.min(100, Math.round((loaded / total) * 100));
      toast.loading(
        percent < 100
          ? `Downloading the background model (${megabytes} MB, once): ${percent}%`
          : "Removing the background…",
        { id: progress },
      );
    });
    toast.success("Background removed", { id: progress });
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not remove the background.", {
      id: progress,
    });
    // The agent's tool reports the reason itself.
    if (options.rethrow) throw error;
    return null;
  }
};

/** "Remove background", plus "High quality" when the user has a gpt-image model set up. */
export const RemoveBackgroundButtons = ({
  src,
  onRemoved,
}: {
  src: string;
  /** Apply the cut-out (one undo step). */
  onRemoved: (src: string) => void;
}) => {
  const [busy, setBusy] = useState<RemovalQuality | null>(null);
  const [highQuality, setHighQuality] = useState(false);
  useEffect(() => {
    let live = true;
    void providerRemovalAvailable().then((available) => {
      if (live) setHighQuality(available);
    });
    return () => {
      live = false;
    };
  }, []);

  const run = async (quality: RemovalQuality) => {
    setBusy(quality);
    try {
      const cut = await removeBackgroundWithProgress(src, quality);
      if (cut) onRemoved(cut);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PropertyRow className={highQuality ? undefined : "grid-cols-1"}>
      <Button
        variant="secondary"
        size="xs"
        className="h-7"
        disabled={busy !== null}
        title="Cut the subject out on this device (free, private; the model downloads once)"
        onClick={() => void run("standard")}
      >
        {busy === "standard" ? <Spinner className="size-3" /> : <ScissorsIcon />}
        Remove background
      </Button>
      {highQuality ? (
        <Button
          variant="secondary"
          size="xs"
          className="h-7"
          disabled={busy !== null}
          title="Cut the subject out with your gpt-image model (finer edges; one request on your key)"
          onClick={() => void run("high")}
        >
          {busy === "high" ? (
            <Spinner className="size-3" />
          ) : (
            <SparklesIcon className="text-violet" />
          )}
          High quality
        </Button>
      ) : null}
    </PropertyRow>
  );
};
