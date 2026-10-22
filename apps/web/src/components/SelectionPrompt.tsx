import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, SparklesIcon, SquareIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { Spinner } from "@pego/ui/components/spinner";
import { getLayout } from "@/canvas/layout";
import { docToScreen } from "@/canvas/types";
import { cancelRun, startRun } from "@/agent/run";
import { useAgentStore } from "@/agent/use-agent-store";
import { useInteractionState } from "@/interaction/interaction-state";
import { showAgentPanel } from "@/layout/use-panels-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";
import { useDocumentStore } from "@/store/use-document-store";
import { useTextEditStore } from "@/store/use-text-edit-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = isMac ? "⌘K" : "Ctrl+K";
/** Gap between the selection and the prompt, and to the canvas edges (px). */
const GAP = 8;
const OPEN_WIDTH = 320;
const ROW_HEIGHT = 32;

type Rect = { x: number; y: number; width: number; height: number };

/** Union of the selected layers' boxes in document coordinates (null when none is laid out). */
const selectionBounds = (
  boxes: ReadonlyMap<string, Rect> | { get: (id: string) => Rect | undefined },
  ids: readonly string[],
): Rect | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const box = boxes.get(id);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Ask the agent about the selected layers right on the canvas (like pen.dev): a small "Ask AI"
 * button above the selection opens a prompt (⌘K / Ctrl+K). The run is scoped to the selection;
 * its log shows in the Agent tab of the left panel.
 */
export const SelectionPrompt = () => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const camera = useViewportStore((s) => s.camera);
  const size = useViewportStore((s) => s.size);
  const selectTool = useToolStore((s) => s.tool === "select");
  const editingText = useTextEditStore((s) => s.target !== null);
  const busyCanvas = useInteractionState((s) => s.marquee !== null || s.panning);
  const status = useAgentStore((s) => s.status);
  const running = isRunActive(status);

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  /** The layers the running canvas prompt is about (the indicator stays on them). */
  const [runIds, setRunIds] = useState<readonly string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A finished run releases its layers.
  const scopedIds = running ? runIds : null;
  const ids = scopedIds ?? selection;
  const bounds = useMemo(() => selectionBounds(getLayout(doc), ids), [doc, ids]);
  const visible =
    ids.length > 0 &&
    bounds !== null &&
    selectTool &&
    !editingText &&
    !busyCanvas &&
    size.width > 0;

  // A new selection closes an open prompt (adjusted during render, not in an effect).
  const [seenSelection, setSeenSelection] = useState(selection);
  if (seenSelection !== selection) {
    setSeenSelection(selection);
    setOpen(false);
  }
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      const { selection: current } = useDocumentStore.getState();
      if (current.length === 0 || useTextEditStore.getState().target !== null) return;
      event.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!visible || !bounds) return null;

  const topLeft = docToScreen(camera, bounds.x, bounds.y);
  const bottom = docToScreen(camera, bounds.x, bounds.y + bounds.height).y;
  const width = open ? OPEN_WIDTH : 140;
  const above = topLeft.y - ROW_HEIGHT - GAP;
  const top = above >= GAP ? above : Math.min(bottom + GAP, size.height - ROW_HEIGHT - GAP);
  const left = Math.min(Math.max(topLeft.x, GAP), Math.max(GAP, size.width - width - GAP));
  const count = ids.length;
  const label = count === 1 ? "this layer" : `${count} layers`;

  const send = () => {
    const prompt = value.trim();
    if (!prompt || running) return;
    const scope = [...selection];
    setRunIds(scope);
    setValue("");
    setOpen(false);
    showAgentPanel();
    void safely(() => startRun(prompt, { selection: scope })).then((ok) => {
      if (!ok) {
        setRunIds(null);
        setValue(prompt);
        setOpen(true);
      }
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep editor shortcuts (delete, tools, nudges) away from the prompt.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div
      className="absolute z-30 animate-[pego-fade-in_var(--duration-fast)_var(--ease-out)]"
      style={{ left, top }}
      // The canvas must not treat clicks here as a click on the document (deselect, drag).
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {scopedIds ? (
        <div className="flex h-8 items-center gap-2 rounded-full border border-violet/50 bg-card/95 pr-1 pl-3 text-xs text-foreground shadow-md backdrop-blur">
          <Spinner className="size-3 text-violet" />
          <span>AI is editing {label}…</span>
          <button
            type="button"
            aria-label="Stop the agent"
            title="Stop"
            onClick={() => void safely(cancelRun)}
            className="flex size-6 items-center justify-center rounded-full bg-foreground text-background outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <SquareIcon className="size-2.5 fill-current" />
          </button>
        </div>
      ) : open ? (
        <div
          className="flex h-8 items-center gap-1 rounded-full border border-ring bg-card/95 pr-1 pl-3 shadow-md backdrop-blur"
          style={{ width: OPEN_WIDTH }}
        >
          <SparklesIcon aria-hidden className="size-3.5 shrink-0 text-violet" />
          <input
            ref={inputRef}
            aria-label={`Ask AI about ${label}`}
            value={value}
            disabled={running}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (!value.trim()) setOpen(false);
            }}
            placeholder={running ? "The agent is busy…" : `Ask AI to change ${label}…`}
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!value.trim() || running}
            onClick={send}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-30"
          >
            <ArrowUpIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          title={`Ask AI about ${label} (${SHORTCUT})`}
          disabled={running}
          onClick={() => setOpen(true)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 text-xs text-foreground shadow-md backdrop-blur outline-none transition-colors hover:border-violet/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
          )}
        >
          <SparklesIcon aria-hidden className="size-3.5 text-violet" />
          Ask AI
          <span className="text-[10px] text-muted-foreground">{SHORTCUT}</span>
        </button>
      )}
    </div>
  );
};
