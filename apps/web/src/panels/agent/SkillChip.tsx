import { useEffect, useState, type RefObject } from "react";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { skills } from "@pego/agent";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { navigateList } from "@/panels/agent/list-nav";
import { isRunActive } from "@/panels/agent/agent-format";
import { pickableSkills, skillChipView } from "@/panels/agent/skill-chip";

const DEBOUNCE_MS = 250;

const useDebounced = <T,>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const rowClass =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent";

type RowProps = { checked: boolean; title: string; note?: string; onClick: () => void };

const Row = ({ checked, title, note, onClick }: RowProps) => (
  <button
    data-nav
    type="button"
    role="menuitemradio"
    aria-checked={checked}
    title={note}
    onClick={onClick}
    className={cn(rowClass, checked && "bg-accent/60")}
  >
    <span className="min-w-0 truncate">{title}</span>
    <span className="ml-auto flex shrink-0">
      {checked ? <CheckIcon aria-hidden className="size-3.5" /> : null}
    </span>
  </button>
);

type SkillChipProps = {
  /** The text being typed; the chip shows the skill detected from it. */
  prompt: string;
  /** Where focus goes after the popover closes (the prompt box). */
  restoreFocusRef: RefObject<HTMLElement | null>;
};

/**
 * Composer chip: the skill the next run will follow ("Landing page · auto"). Click to pick
 * another skill, "None (core only)" or back to auto. A manual choice lasts for one run.
 */
export const SkillChip = ({ prompt, restoreFocusRef }: SkillChipProps) => {
  const selectedId = useAgentStore((s) => s.selectedSkillId);
  const setSelected = useAgentStore((s) => s.setSelectedSkill);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(prompt, DEBOUNCE_MS);

  const options = pickableSkills(skills);
  if (options.length === 0) return null;

  const view = skillChipView(debounced, selectedId);
  const pick = (id: string | null | undefined) => {
    setSelected(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={locked}
        aria-label={`Skill: ${view.label}${view.suffix ? ` (${view.suffix})` : ""}`}
        title={view.skill?.description ?? "Pick a design skill"}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <SparklesIcon aria-hidden className="size-3 shrink-0" />
        <span className={cn("max-w-[120px] min-w-0 truncate", view.skill && "text-foreground")}>
          {view.label}
        </span>
        {view.suffix ? <span className="shrink-0">· {view.suffix}</span> : null}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const target =
            event.currentTarget instanceof HTMLElement
              ? (event.currentTarget.querySelector<HTMLElement>('[aria-checked="true"]') ??
                event.currentTarget.querySelector<HTMLElement>("[data-nav]"))
              : null;
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusRef.current?.focus();
        }}
        className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[240px] max-w-[calc(100vw-1rem)] overflow-y-auto p-1"
      >
        <div role="menu" aria-label="Skill" onKeyDown={navigateList} className="grid">
          <Row
            checked={selectedId === undefined}
            title="Auto"
            note="Detect from the prompt"
            onClick={() => pick(undefined)}
          />
          {options.map((skill) => (
            <Row
              key={skill.id}
              checked={selectedId === skill.id}
              title={skill.title}
              note={skill.description}
              onClick={() => pick(skill.id)}
            />
          ))}
          <div role="separator" className="my-0.5 h-px bg-border" />
          <Row checked={selectedId === null} title="None (core only)" onClick={() => pick(null)} />
        </div>
      </PopoverContent>
    </Popover>
  );
};
