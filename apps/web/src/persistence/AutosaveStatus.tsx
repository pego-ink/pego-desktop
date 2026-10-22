import { useEffect, useState } from "react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { resumeAutoSave, retryAutoSave } from "./autosave-actions";
import { isFileAutosaveSupported } from "./file-autosave";
import { useAutosaveStore } from "./use-autosave-store";
import { useFileStore, useIsDirty } from "./use-file-store";
import { untitledLabel } from "./save-hint";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

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
  offline: "Bridge offline, changes kept in this browser",
} as const;

/**
 * Save state, shown as the muted subtitle under the file name (`compact`: inline beside it, in the
 * desktop title row).
 */
export const AutosaveStatus = ({ compact = false }: { compact?: boolean }) => {
  const status = useAutosaveStore((s) => s.status);
  const enabled = useAutosaveStore((s) => s.enabled);
  const handle = useFileStore((s) => s.handle);
  const bridgePath = useFileStore((s) => s.bridgePath);
  // Without a handle or a bridge file nothing autosaves to disk, unless the browser can only
  // download anyway.
  const supported = isFileAutosaveSupported();
  const untitled = useFileStore(
    (s) => s.handle === null && s.bridgePath === null && (s.fileName === null || supported),
  );
  const dirty = useIsDirty();
  const savedMounted = useFadeOut(status === "saved");

  const writable = (supported && handle !== null) || bridgePath !== null;
  const fileAutosave = enabled && writable && status !== "needs-permission";
  const showDot = dirty && !(fileAutosave && status !== "paused" && status !== "offline");

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
      {status === "offline" ? (
        <span
          aria-hidden
          className="truncate"
          title="Saves to the project file once the bridge is back"
        >
          Bridge offline
        </span>
      ) : null}
      {untitled ? (
        <span aria-hidden className="truncate">
          {untitledLabel(compact, isMac)}
        </span>
      ) : null}
    </span>
  );
};
