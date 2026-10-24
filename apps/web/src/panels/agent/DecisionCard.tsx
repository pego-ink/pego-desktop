import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon, CircleHelpIcon, CornerDownLeftIcon, PencilIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { answerDecision } from "@/agent/run";
import { useVisibleRun, type PendingDecision } from "@/agent/use-agent-store";
import {
  isTypingTarget,
  nextRowIndex,
  normalizeCustomAnswer,
  optionIndexForKey,
} from "@/panels/agent/decision-input";
import { safely } from "@/panels/agent/run-actions";

/** How long the selected row stays visible before the card collapses. */
const CONFIRM_MS = 280;

type Chosen = { row: number; answer: string };

type OptionRowProps = {
  badge: ReactNode;
  children: ReactNode;
  shortcut?: string;
  active: boolean;
  selected: boolean;
  dimmed: boolean;
  tabIndex: number;
  onClick: () => void;
  onActivate: () => void;
};

const OptionRow = ({
  badge,
  children,
  shortcut,
  active,
  selected,
  dimmed,
  tabIndex,
  onClick,
  onActivate,
}: OptionRowProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    aria-keyshortcuts={shortcut}
    aria-disabled={dimmed || undefined}
    tabIndex={tabIndex}
    data-active={active || undefined}
    data-selected={selected || undefined}
    onClick={onClick}
    onFocus={onActivate}
    onMouseEnter={onActivate}
    className={cn(
      "group/row flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left text-[13px] leading-5 font-semibold text-foreground outline-none",
      "transition-[background-color,opacity,scale] duration-(--duration-fast) ease-out",
      "data-active:border-violet data-active:bg-violet-soft data-selected:border-violet data-selected:bg-violet-soft data-selected:focus-visible:ring-0 focus-visible:ring-2 focus-visible:ring-ring/50",
      "motion-safe:active:scale-[.97]",
      dimmed && "pointer-events-none opacity-40",
    )}
  >
    <span
      aria-hidden
      className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md border bg-muted font-mono text-[11px] font-medium text-muted-foreground tabular-nums transition-colors duration-(--duration-fast) ease-out group-data-active/row:border-violet group-data-active/row:text-violet-text group-data-selected/row:border-violet group-data-selected/row:bg-primary group-data-selected/row:text-primary-foreground"
    >
      {selected ? <CheckIcon className="size-3" strokeWidth={2.5} /> : badge}
    </span>
    <span className="min-w-0 flex-1 break-words text-pretty">{children}</span>
    <CornerDownLeftIcon
      aria-hidden
      className="mt-[3px] size-3.5 shrink-0 text-violet-text opacity-0 transition-opacity duration-(--duration-fast) ease-out group-data-active/row:opacity-100 group-data-selected/row:opacity-0"
    />
  </button>
);

export const DecisionCard = ({ decision }: { decision: PendingDecision }) => {
  const { options } = decision;
  const otherRow = options.length;
  const questionId = useId();
  const headingId = useId();
  const stepTitle = useVisibleRun((s) =>
    decision.stepId ? s.steps.find((step) => step.id === decision.stepId)?.title : undefined,
  );

  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const groupRef = useRef<HTMLDivElement>(null);
  const rowAt = (row: number) =>
    groupRef.current?.querySelectorAll<HTMLElement>("[role=radio]")[row] ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef(0);

  const commit = (row: number, answer: string) => {
    if (chosen) return;
    setChosen({ row, answer });
    setEditing(false);
    // Keep focus on the picked row so it never sits on a dimmed one.
    requestAnimationFrame(() => rowAt(row)?.focus({ preventScroll: true }));
    // Hold the selected state for a beat, then answer; the card collapses once the store clears it.
    timerRef.current = window.setTimeout(
      () => void safely(() => answerDecision(decision.id, answer)),
      CONFIRM_MS,
    );
  };

  const focusRow = (row: number) => {
    setActive(row);
    rowAt(row)?.focus({ preventScroll: true });
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Move focus into the card once it is interactive (Reveal keeps it inert for one frame),
  // unless the user is already typing somewhere.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (isTypingTarget(document.activeElement as HTMLElement | null)) return;
        rowAt(0)?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  // 1-4 pick an option while the card is shown and focus is not in a text field.
  useEffect(() => {
    if (chosen || editing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return;
      const index = optionIndexForKey(event, options.length);
      if (index === null) return;
      event.preventDefault();
      commit(index, options[index] ?? "");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const onGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (chosen || editing) return;
    const count = options.length + 1;
    const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (delta === 1 || delta === -1) {
      event.preventDefault();
      focusRow(nextRowIndex(active, delta, count));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(count - 1);
    }
  };

  const startEditing = () => {
    if (chosen) return;
    setActive(otherRow);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft("");
    requestAnimationFrame(() => focusRow(otherRow));
  };

  const submitDraft = () => {
    const answer = normalizeCustomAnswer(draft);
    if (answer) commit(otherRow, answer);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEditing();
    }
  };

  const rowProps = (row: number) => ({
    active: active === row && !chosen,
    selected: chosen?.row === row,
    dimmed: chosen !== null && chosen.row !== row,
    tabIndex: active === row ? 0 : -1,
    onActivate: () => {
      if (!chosen) setActive(row);
    },
  });

  return (
    <section
      aria-labelledby={headingId}
      className="origin-bottom animate-[pego-pop-in_var(--duration-base)_var(--ease-out)] rounded-2xl border border-warning bg-background p-3"
    >
      <h3
        id={headingId}
        className="flex items-center gap-1.5 px-1 pb-1.5 text-xs leading-4 font-semibold text-warning"
      >
        <CircleHelpIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="shrink-0">Needs your decision</span>
        {stepTitle ? (
          <span className="min-w-0 truncate font-normal text-muted-foreground">· {stepTitle}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[10px] font-normal text-subtle-foreground">
          run paused
        </span>
      </h3>
      <p
        id={questionId}
        className="px-1 pb-2 text-[15px] leading-5 font-semibold break-words text-pretty text-foreground"
      >
        {decision.question}
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={questionId}
        onKeyDown={onGroupKeyDown}
        className="flex flex-col gap-1"
      >
        {options.map((option, index) => (
          <OptionRow
            key={`${index}-${option}`}
            badge={index + 1}
            shortcut={String(index + 1)}
            onClick={() => commit(index, option)}
            {...rowProps(index)}
          >
            {option}
          </OptionRow>
        ))}
        {editing && !chosen ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted px-2 py-1.5 transition-shadow duration-(--duration-fast) ease-out focus-within:border-violet focus-within:ring-2 focus-within:ring-violet/30">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-background text-violet-text"
            >
              <PencilIcon className="size-3" />
            </span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              aria-label="Your answer"
              aria-keyshortcuts="Enter Escape"
              placeholder="Type your answer"
              autoComplete="off"
              spellCheck={false}
              className="h-6 min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <button
              type="button"
              aria-label="Send answer"
              disabled={normalizeCustomAnswer(draft) === null}
              onClick={submitDraft}
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground outline-none transition-[background-color,opacity] duration-(--duration-fast) ease-out hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
            >
              <CornerDownLeftIcon aria-hidden className="size-3.5" />
            </button>
          </div>
        ) : (
          <OptionRow
            badge={<PencilIcon className="size-3" />}
            onClick={startEditing}
            {...rowProps(otherRow)}
          >
            {chosen?.row === otherRow ? chosen.answer : "Other…"}
          </OptionRow>
        )}
      </div>
      <p
        aria-hidden
        className="flex items-center gap-3 px-1 pt-2 font-mono text-[10px] text-subtle-foreground"
      >
        <span>1-{Math.max(options.length, 1)} choose</span>
        <span>↑↓ move</span>
        <span>↵ confirm</span>
        <span>esc cancel</span>
      </p>
      <p role="status" className="sr-only">
        {chosen ? `Selected: ${chosen.answer}` : ""}
      </p>
    </section>
  );
};
