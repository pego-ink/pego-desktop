import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowUpIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { findNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { Textarea } from "@pego/ui/components/textarea";
import { Tooltip } from "@pego/ui/components/tooltip";
import { getLayout } from "@/canvas/layout";
import { submitPrompt } from "@/agent/queue";
import { createSessionInBackground } from "@/agent/sessions/session-sync";
import { liveTitle, useAgentStore } from "@/agent/use-agent-store";
import { frameCorners, getSelectionFrame, toScreenMatrix } from "@/interaction/selection-frame";
import { useDocumentStore } from "@/store/use-document-store";
import { useSelectionPrompt } from "@/store/use-selection-prompt-store";
import { useTextEditStore } from "@/store/use-text-edit-store";
import { useShallow } from "zustand/react/shallow";
import { useViewportStore, visibleRect } from "@/store/use-viewport-store";
import { CodePreviewDialog } from "@/export/CodePreviewDialog";
import { MAGIC_ACTIONS, magicDisplay, magicPrompt, type MagicAction } from "./pego-magic";
import {
  BUTTON_SIZE,
  PROMPT_HEIGHT,
  PROMPT_WIDTH,
  buildTargetPrompt,
  intersectsViewport,
  placeAtAnchor,
  placePromptBox,
  summarizeTargets,
  topRightAnchor,
  type PromptTarget,
} from "./selection-prompt-position";

type ChatMode = "this" | "new";

const MODES = [
  { value: "this", label: "This chat" },
  { value: "new", label: "New chat" },
] as const;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = isMac ? "⌘K" : "Ctrl+K";

/** Time after the last camera change before the button comes back. */
const SETTLE_MS = 160;

const FLOAT_SURFACE =
  "rounded-lg border border-border bg-popover shadow-[0_8px_24px_#00000055] motion-safe:animate-[pego-pop-in_var(--duration-fast)_var(--ease-out)]";

/** Selected layers as the agent will see them: id plus a readable name. */
const targetsOf = (ids: readonly string[]): PromptTarget[] => {
  const { doc } = useDocumentStore.getState();
  return ids.flatMap((id) => {
    const node = findNode(doc, id);
    return node ? [{ id, name: node.name?.trim() || node.type }] : [];
  });
};

/** True while the pointer is down on the canvas (drag, resize, marquee, pan) or the camera is moving. */
const useCanvasBusy = (): boolean => {
  const [pressed, setPressed] = useState(false);
  const [moving, setMoving] = useState(false);
  const camera = useViewportStore((s) => s.camera);
  const first = useRef(true);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) setPressed(true);
    };
    const up = () => setPressed(false);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [camera]);

  return pressed || moving;
};

/**
 * Send the pinned prompt to the visible chat, or to a fresh background one, and say where it went.
 * `display` is what the chat shows (the typed text, or a Pego Magic title).
 */
const sendFrom = (targets: PromptTarget[], text: string, mode: ChatMode, display = text) => {
  const prompt = buildTargetPrompt(targets, text);
  // The agent gets the pinned targets; the transcript and chat title show only the display text.
  const options = { displayText: display };
  if (mode === "new") {
    const id = createSessionInBackground();
    const result = submitPrompt(id, prompt, options);
    if (result === "refused") return toast.error("Couldn't send the prompt");
    return toast(result === "queued" ? "Queued in a new chat" : "Started in a new chat", {
      description: display.slice(0, 80),
    });
  }
  const id = useAgentStore.getState().visibleSessionId;
  const result = submitPrompt(id, prompt, options);
  if (result === "refused") return toast.error("Couldn't send the prompt");
  if (result === "started") return toast("Sent to this chat");
  const live = useAgentStore.getState().liveSessions[id];
  return toast(`Queued in ${live ? liveTitle(live) : "this chat"}`);
};

type PromptBoxProps = {
  left: number;
  top: number;
  targets: PromptTarget[];
  onClose: () => void;
  /** Pego Magic › Export HTML for the selection. */
  onExportHtml: () => void;
  boxRef: RefObject<HTMLDivElement | null>;
};

/**
 * Pego Magic: one click on an idea runs it on the selection (a new copy beside it), or opens the
 * HTML export. Uses the box's This chat / New chat choice.
 */
const MagicActions = ({ onPick }: { onPick: (action: MagicAction) => void }) => (
  <div className="grid gap-1.5">
    <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-foreground">
      <WandSparklesIcon aria-hidden className="size-3.5 text-violet" />
      Pego Magic
    </div>
    <div role="group" aria-label="Pego Magic" className="flex flex-wrap gap-1">
      {MAGIC_ACTIONS.map((action) => (
        <Tooltip key={action.id} content={action.hint} side="bottom">
          <button
            type="button"
            onClick={() => onPick(action)}
            className="h-6 rounded-full bg-violet/15 px-2.5 text-[11px] font-medium text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-violet/30 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {action.label}
          </button>
        </Tooltip>
      ))}
    </div>
  </div>
);

const PromptBox = ({ left, top, targets, onClose, onExportHtml, boxRef }: PromptBoxProps) => {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("this");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!canSend) return;
    void sendFrom(targets, text.trim(), mode);
    onClose();
  };

  const runMagic = (action: MagicAction) => {
    if (action.id === "export-html") return onExportHtml();
    void sendFrom(targets, magicPrompt(action.id), mode, magicDisplay(action));
    onClose();
  };

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Ask Pego about the selection"
      style={{ left, top, width: PROMPT_WIDTH }}
      onKeyDown={(e) => {
        // Esc and the open shortcut close from anywhere in the box, not only the text field.
        if (e.key !== "Escape" && !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))
          return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      className={`pointer-events-auto absolute flex origin-top-left flex-col gap-2 p-2 ${FLOAT_SURFACE}`}
    >
      <p className="truncate px-0.5 text-[11px] text-muted-foreground">
        {summarizeTargets(targets.map((t) => t.name))}
      </p>
      <MagicActions onPick={runMagic} />
      <Textarea
        ref={inputRef}
        value={text}
        rows={1}
        aria-label="Prompt"
        placeholder="Ask Pego to change this…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-32 min-h-9 resize-none [field-sizing:content]"
      />
      <div className="flex items-center gap-2">
        <SegmentedControl
          aria-label="Where to run"
          value={mode}
          options={MODES}
          onChange={setMode}
          className="w-44"
        />
        <span className="flex-1" />
        <Tooltip content="Send" shortcut="↵" side="bottom">
          <Button size="icon-sm" aria-label="Send" disabled={!canSend} onClick={submit}>
            <ArrowUpIcon />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

/**
 * Floating "ask Pego about this" button next to the selection, and the compact prompt box it
 * opens. Mount inside the (relative) canvas container; `canvasRef` gets focus back on close.
 */
export const SelectionPrompt = ({
  canvasRef,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) => {
  // Pego Magic › Export HTML: the chosen layer's code preview, kept open after the box closes.
  const [exportId, setExportId] = useState<string | null>(null);
  return (
    <>
      <SelectionPromptOverlay canvasRef={canvasRef} onExportHtml={setExportId} />
      {exportId && (
        <CodePreviewDialog
          open
          onOpenChange={(next) => !next && setExportId(null)}
          nodeId={exportId}
          format="html-css"
        />
      )}
    </>
  );
};

const SelectionPromptOverlay = ({
  canvasRef,
  onExportHtml,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onExportHtml: (nodeId: string) => void;
}) => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const camera = useViewportStore((s) => s.camera);
  // Kept inside the part of the canvas not covered by floating panels.
  const viewport = useViewportStore(useShallow(visibleRect));
  const editing = useTextEditStore((s) => s.target !== null);
  const open = useSelectionPrompt((s) => s.open);
  const setOpen = useSelectionPrompt((s) => s.setOpen);
  const busy = useCanvasBusy();
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxHeight, setBoxHeight] = useState(PROMPT_HEIGHT);

  const frames = useMemo(() => {
    const layout = getLayout(doc);
    return selection.flatMap((id) => {
      const frame = getSelectionFrame(doc, layout, id);
      if (!frame) return [];
      return [
        frameCorners(toScreenMatrix(camera, frame.matrix), frame.box.width, frame.box.height),
      ];
    });
  }, [doc, selection, camera]);

  const anchor = useMemo(() => topRightAnchor(frames), [frames]);

  const close = () => {
    setOpen(false);
    canvasRef.current?.focus({ preventScroll: true });
  };

  // Nothing selected, text editing started or a canvas gesture began: the box has no subject.
  const orphaned = anchor === null || editing || busy;
  useEffect(() => {
    if (open && orphaned) setOpen(false);
  }, [open, orphaned, setOpen]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!open || !box) return;
    const observer = new ResizeObserver(() => setBoxHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [open]);

  if (!anchor || editing || viewport.width === 0) return null;

  const buttonPos = placeAtAnchor(anchor, { width: BUTTON_SIZE, height: BUTTON_SIZE }, viewport, {
    up: true,
  });

  if (open) {
    const pos = placePromptBox(buttonPos, { width: PROMPT_WIDTH, height: boxHeight }, viewport);
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <PromptBox
          // A new subject starts a new draft.
          key={selection.join(",")}
          left={pos.x}
          top={pos.y}
          targets={targetsOf(selection)}
          onClose={close}
          onExportHtml={() => {
            if (selection[0]) onExportHtml(selection[0]);
            setOpen(false);
          }}
          boxRef={boxRef}
        />
      </div>
    );
  }

  if (busy || !intersectsViewport(frames, viewport)) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`pointer-events-auto absolute p-0.5 ${FLOAT_SURFACE}`}
        style={{ left: buttonPos.x - 2, top: buttonPos.y - 2 }}
      >
        <Tooltip content="Pego Magic: ask, or pick an idea" shortcut={SHORTCUT} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Pego Magic"
            onClick={() => setOpen(true)}
          >
            <SparklesIcon />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};
