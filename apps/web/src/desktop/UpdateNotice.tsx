import { useState } from "react";
import { useUpdateStatus } from "@/desktop/use-update-status";
import { desktopApi } from "@/desktop/desktop-api";
import {
  noticeTitle,
  noticeView,
  sameNoticeView,
  type NoticeView,
} from "@/desktop/update-notice-model";
import { Button } from "@pego/ui/components/button";

/**
 * Floating update card, bottom-right (clear of the agent composer). Shows download progress, then "ready" with Restart / Later.
 * Renders nothing in a plain browser (the status never leaves "idle" there).
 */
export const UpdateNotice = () => {
  const status = useUpdateStatus((s) => s.status);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const view = noticeView(status, dismissed);

  // Keep the last view while the exit animation plays (derived state, adjusted during render).
  const [kept, setKept] = useState<NoticeView | null>(null);
  if (view && !sameNoticeView(kept, view)) setKept(view);

  const shown = view ?? kept;
  if (!shown) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && !view) setKept(null);
      }}
      className={
        view
          ? "fixed right-3 bottom-3 z-40 w-64 animate-[pego-slide-up-in_var(--duration-slow)_var(--ease-out)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          : "pointer-events-none fixed right-3 bottom-3 z-40 w-64 animate-[pego-fade-out_var(--duration-base)_var(--ease-out)_forwards] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      }
    >
      <p className="text-sm font-medium">{noticeTitle(shown)}</p>
      {shown.kind === "ready" ? (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">Restart to update.</p>
          <div className="mt-2.5 flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setDismissed(shown.version)}>
              Later
            </Button>
            <Button size="xs" onClick={() => desktopApi()?.installUpdate()}>
              Restart
            </Button>
          </div>
        </>
      ) : (
        <div
          role="progressbar"
          aria-label="Update download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown.percent}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full origin-left rounded-full bg-primary transition-[width] duration-(--duration-base) ease-out"
            style={{ width: `${shown.percent}%` }}
          />
        </div>
      )}
    </div>
  );
};
