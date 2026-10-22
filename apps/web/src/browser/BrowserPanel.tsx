import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  CircleAlertIcon,
  ImportIcon,
  MousePointerClickIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { BrowserTarget } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { Input } from "@pego/ui/components/input";
import { Spinner } from "@pego/ui/components/spinner";
import { Tooltip } from "@pego/ui/components/tooltip";
import { cn } from "@pego/ui/lib/utils";
import { useBrowserStore } from "@/browser/use-browser-store";
import { importToCanvas, screenshotToCanvas } from "@/browser/browser-actions";
import {
  browserApi,
  ensureBrowserConnected,
  startPicker,
  stopPicker,
} from "@/browser/browser-session";
import { hasOpenOverlay, sameBounds, viewBounds } from "@/browser/browser-panel-view";
import type { DesktopBrowserBounds } from "@/desktop/desktop-api";

const EXAMPLE_URLS = ["localhost:5173", "localhost:3000", "pego.ink"] as const;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const reportError = (error: unknown) => toast.error(messageOf(error));

const navigateTo = async (url: string) => {
  try {
    await browserApi()?.navigate(url, { allowFile: true });
  } catch (error) {
    reportError(error);
  }
};

/** Back, forward, reload / stop and the address field. */
const AddressBar = () => {
  const url = useBrowserStore((s) => s.state.url);
  const loading = useBrowserStore((s) => s.state.loading);
  const canGoBack = useBrowserStore((s) => s.state.canGoBack);
  const canGoForward = useBrowserStore((s) => s.state.canGoForward);
  const picking = useBrowserStore((s) => s.picking);
  const hasPage = url !== "";
  /** What the user is typing; null while the field just mirrors the page URL. */
  const [draft, setDraft] = useState<string | null>(null);

  const submit = () => {
    const value = (draft ?? url).trim();
    if (!value) return;
    void navigateTo(value);
  };

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  const togglePicker = () => {
    const run = picking ? stopPicker() : startPicker();
    Promise.resolve(run).catch(reportError);
  };

  return (
    <PanelHeader className="relative justify-start">
      <Tooltip content="Back" side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={() => browserApi()?.back()}
        >
          <ArrowLeftIcon />
        </Button>
      </Tooltip>
      <Tooltip content="Forward" side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={() => browserApi()?.forward()}
        >
          <ArrowRightIcon />
        </Button>
      </Tooltip>
      <Tooltip content={loading ? "Stop" : "Reload"} side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={loading ? "Stop loading" : "Reload"}
          disabled={!hasPage}
          onClick={() => (loading ? browserApi()?.stop() : browserApi()?.reload())}
        >
          {loading ? <XIcon /> : <RotateCwIcon />}
        </Button>
      </Tooltip>
      <Input
        type="text"
        inputMode="url"
        aria-label="Address"
        placeholder="Search or enter a URL"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        value={draft ?? url}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(url);
          e.currentTarget.select();
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={onFieldKeyDown}
        className="min-w-0 flex-1"
      />
      <Tooltip content={picking ? "Stop picking" : "Pick an element"} shortcut="Esc" side="top">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Pick an element"
          aria-pressed={picking}
          disabled={!hasPage}
          onClick={togglePicker}
          className={cn(picking && "bg-muted text-foreground")}
        >
          <MousePointerClickIcon />
        </Button>
      </Tooltip>
      <div
        aria-hidden={!loading}
        className={cn(
          "pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-primary transition-opacity duration-(--duration-fast) ease-out motion-safe:animate-pulse",
          loading ? "opacity-100" : "opacity-0",
        )}
      />
    </PanelHeader>
  );
};

type Action = "screenshot" | "import";

/** Screenshot / import the page, or the picked element when there is one. */
const ActionBar = () => {
  const hasPage = useBrowserStore((s) => s.state.url !== "" && !s.state.error);
  const hasPicked = useBrowserStore((s) => s.hasPicked);
  const [busy, setBusy] = useState<Action | null>(null);
  const subject = hasPicked ? "selection" : "page";
  const target: BrowserTarget = hasPicked ? { kind: "selection" } : { kind: "full-page" };

  const run = async (action: Action) => {
    setBusy(action);
    try {
      await (action === "screenshot" ? screenshotToCanvas(target) : importToCanvas(target));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const actions: { id: Action; label: string; icon: typeof CameraIcon }[] = [
    { id: "screenshot", label: "Screenshot", icon: CameraIcon },
    { id: "import", label: "Import", icon: ImportIcon },
  ];

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      {actions.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id} content={`${label} the ${subject} to canvas`} side="top">
          <Button
            variant="secondary"
            size="xs"
            disabled={!hasPage || busy !== null}
            onClick={() => void run(id)}
          >
            {busy === id ? <Spinner className="size-3" /> : <Icon />}
            {label} {subject}
          </Button>
        </Tooltip>
      ))}
    </div>
  );
};

const EmptyState = () => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <p className="text-xs leading-4 text-muted-foreground">
      Open a page to inspect it, pick an element, and bring it onto the canvas.
    </p>
    <ul aria-label="Examples" className="flex flex-wrap justify-center gap-1.5">
      {EXAMPLE_URLS.map((example) => (
        <li key={example}>
          <Button variant="secondary" size="xs" onClick={() => void navigateTo(example)}>
            {example}
          </Button>
        </li>
      ))}
    </ul>
  </div>
);

const ErrorState = ({ message }: { message: string }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <CircleAlertIcon className="size-5 text-destructive" aria-hidden />
    <p role="alert" className="text-xs leading-4 text-muted-foreground">
      {message}
    </p>
    <Button variant="secondary" size="xs" onClick={() => browserApi()?.reload()}>
      <RotateCwIcon />
      Retry
    </Button>
  </div>
);

/**
 * Browser tab: address bar, actions, and a region the native desktop view is drawn over. The
 * region is re-measured on resize (window, panel drag) and the view is hidden whenever the
 * region has no area, an overlay is open, or the panel unmounts (see `viewBounds`).
 */
export const BrowserPanel = () => {
  const url = useBrowserStore((s) => s.state.url);
  const error = useBrowserStore((s) => s.state.error);
  const picking = useBrowserStore((s) => s.picking);
  const hasContent = url !== "" && !error;
  const regionRef = useRef<HTMLDivElement>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  /** Latest inputs and what the native view was last told, so the observers stay stable. */
  const inputs = useRef({ hasContent, overlayOpen });
  const applied = useRef<DesktopBrowserBounds | null>(null);

  const sync = useCallback(() => {
    const api = browserApi();
    if (!api) return;
    const bounds = viewBounds({
      rect: regionRef.current?.getBoundingClientRect() ?? null,
      ...inputs.current,
    });
    if (bounds) {
      if (!sameBounds(applied.current, bounds)) api.show(bounds);
    } else if (applied.current) {
      api.hide();
    }
    applied.current = bounds;
  }, []);

  useEffect(() => {
    Promise.resolve(ensureBrowserConnected()).catch(reportError);
  }, []);

  // Follow the region: element resize (panel drag, collapse) and window resize.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(region);
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      browserApi()?.hide();
      applied.current = null;
    };
  }, [sync]);

  // Open dialogs, menus and popovers must not end up under the native view.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOverlayOpen(hasOpenOverlay(document)));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "role"],
    });
    check();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    inputs.current = { hasContent, overlayOpen };
    sync();
  }, [sync, hasContent, overlayOpen]);

  // Escape stops the picker (while focus is in the editor, not the page).
  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") Promise.resolve(stopPicker()).catch(reportError);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picking]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AddressBar />
      <ActionBar />
      <div ref={regionRef} className="relative min-h-0 flex-1">
        {url === "" ? <EmptyState /> : error ? <ErrorState message={error} /> : null}
      </div>
    </div>
  );
};
