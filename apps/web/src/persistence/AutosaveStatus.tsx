import { useEffect, useState } from "react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { resumeAutoSave, retryAutoSave } from "./autosave-actions";
import { isFileAutosaveSupported } from "./file-autosave";
import { useAutosaveStore } from "./use-autosave-store";
import { useFileStore, useIsDirty } from "./use-file-store";

const FADE_MS = 200;

/** Keeps "Saved" mounted just long enough to fade out. */
const useFadeOut = (visible: boolean) => {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  return mounted;
};

const SR_TEXT = {
  idle: "",
  saving: "Saving",
  saved: "Saved",
  "needs-permission": "Auto save needs permission",
  paused: "Auto save paused",
} as const;

/** Save state, shown as the muted subtitle under the file name. */
export const AutosaveStatus = () => {
  const status = useAutosaveStore((s) => s.status);
  const enabled = useAutosaveStore((s) => s.enabled);
  const handle = useFileStore((s) => s.handle);
  // Without a handle nothing autosaves to disk, unless the browser can only download anyway.
  const supported = isFileAutosaveSupported();
  const untitled = useFileStore((s) => s.handle === null && (s.fileName === null || supported));
  const dirty = useIsDirty();
  const savedMounted = useFadeOut(status === "saved");

  const fileAutosave = enabled && supported && handle !== null && status !== "needs-permission";
  const showDot = dirty && !(fileAutosave && status !== "paused");

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
      <span role="status" aria-live="polite" className="sr-only">
        {showDot && status === "idle" ? "Unsaved changes" : SR_TEXT[status]}
      </span>
      {/* Always mounted so it can fade; the negative margin cancels its width and the flex gap while hidden. */}
      <span
        aria-hidden
        title={showDot ? "Unsaved changes" : undefined}
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-foreground transition-[opacity,scale] duration-200 ease-out",
          showDot ? "opacity-100" : "-mr-3 scale-50 opacity-0",
        )}
      />
      {status === "saving" ? (
        <span aria-hidden className="animate-[pego-fade-in_var(--duration-base)_var(--ease-out)]">
          Saving…
        </span>
      ) : null}
      {savedMounted ? (
        <span
          aria-hidden
          className={cn(
            "animate-[pego-fade-in_var(--duration-base)_var(--ease-out)] transition-opacity duration-200 ease-out",
            status === "saved" ? "opacity-100" : "opacity-0",
          )}
        >
          Saved
        </span>
      ) : null}
      {status === "needs-permission" ? (
        <Button
          variant="outline"
          size="xs"
          title="Allow Pego to write to this file again"
          onClick={() => void resumeAutoSave()}
        >
          Resume auto save
        </Button>
      ) : null}
      {status === "paused" ? (
        <>
          <span aria-hidden>Auto save paused</span>
          <Button variant="outline" size="xs" onClick={() => void retryAutoSave()}>
            Retry
          </Button>
        </>
      ) : null}
      {untitled ? (
        <span aria-hidden className="truncate">
          Not saved to a file — ⌘S to save
        </span>
      ) : null}
    </span>
  );
};
