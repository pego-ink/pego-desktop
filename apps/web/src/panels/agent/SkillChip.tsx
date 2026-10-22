import { Fragment, useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { skills } from "@pego/agent";
import { Input } from "@pego/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { navigateList } from "@/panels/agent/list-nav";
import { isRunActive } from "@/panels/agent/agent-format";
import {
  filterStyles,
  groupStyles,
  pickableSkills,
  pickableStyles,
  skillChipView,
} from "@/panels/agent/skill-chip";

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

const SectionLabel = ({ children }: { children: string }) => (
  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">{children}</div>
);

type SkillChipProps = {
  /** The text being typed; the chip shows the skills detected from it. */
  prompt: string;
  /** Where focus goes after the popover closes (the prompt box). */
  restoreFocusRef: RefObject<HTMLElement | null>;
};

/**
 * Composer chip: the design skill and style the next run will follow ("Landing page · Bauhaus",
 * detected parts muted). Click to pick a design skill and/or a style, "None", or back to auto.
 * A manual choice lasts for one run.
 */
export const SkillChip = ({ prompt, restoreFocusRef }: SkillChipProps) => {
  const selectedId = useAgentStore((s) => s.selectedSkillId);
  const selectedStyleId = useAgentStore((s) => s.selectedStyleId);
  const setSelected = useAgentStore((s) => s.setSelectedSkill);
  const setSelectedStyle = useAgentStore((s) => s.setSelectedStyle);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(prompt, DEBOUNCE_MS);

  const designs = pickableSkills(skills);
  const styles = pickableStyles(skills);
  if (designs.length === 0 && styles.length === 0) return null;

  const view = skillChipView(debounced, selectedId, selectedStyleId);
  const groups = groupStyles(filterStyles(styles, query));
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const pickDesign = (id: string | null | undefined) => {
    setSelected(id);
    onOpenChange(false);
  };
  const pickStyle = (id: string | null | undefined) => {
    setSelectedStyle(id);
    onOpenChange(false);
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = groups[0]?.skills[0];
    if (first) pickStyle(first.id);
  };
  const tooltip = [view.design.skill, view.style.skill]
    .filter((skill) => skill !== undefined)
    .map((skill) => `${skill.title}: ${skill.description}`)
    .join("\n");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={locked}
        aria-label={`Skills: ${view.label}`}
        title={tooltip || "Pick a design skill and style"}
        className="flex h-7 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <SparklesIcon aria-hidden className="size-3 shrink-0" />
        {view.parts.map((part, index) => (
          <Fragment key={part.text}>
            {index > 0 ? <span className="shrink-0">·</span> : null}
            <span className={cn("max-w-[96px] min-w-0 truncate", !part.muted && "text-foreground")}>
              {part.text}
            </span>
          </Fragment>
        ))}
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
        className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[260px] max-w-[calc(100vw-1rem)] overflow-y-auto p-1"
      >
        <div role="menu" aria-label="Skills" onKeyDown={navigateList} className="grid">
          {designs.length > 0 ? (
            <>
              <SectionLabel>Design</SectionLabel>
              <Row
                checked={selectedId === undefined}
                title="Auto"
                note="Detect from the prompt"
                onClick={() => pickDesign(undefined)}
              />
              <Row
                checked={selectedId === null}
                title="None (core only)"
                onClick={() => pickDesign(null)}
              />
              <div className="max-h-24 overflow-y-auto">
                {designs.map((skill) => (
                  <Row
                    key={skill.id}
                    checked={selectedId === skill.id}
                    title={skill.title}
                    note={skill.description}
                    onClick={() => pickDesign(skill.id)}
                  />
                ))}
              </div>
            </>
          ) : null}
          {designs.length > 0 && styles.length > 0 ? (
            <div role="separator" className="my-1 h-px bg-border" />
          ) : null}
          {styles.length > 0 ? (
            <>
              <SectionLabel>Style</SectionLabel>
              <Row
                checked={selectedStyleId === undefined}
                title="Auto"
                note="Use a style named in the prompt"
                onClick={() => pickStyle(undefined)}
              />
              <Row
                checked={selectedStyleId === null}
                title="None"
                note="No named style: the agent picks a fitting preset"
                onClick={() => pickStyle(null)}
              />
              <Input
                data-nav
                aria-label="Search styles"
                placeholder="Search styles"
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                className="my-0.5 h-7 px-2 text-[13px] md:text-[13px]"
              />
              <div className="max-h-36 overflow-y-auto">
                {groups.map(({ group, skills: items }) => (
                  <div key={group} role="group" aria-label={group}>
                    <SectionLabel>{group}</SectionLabel>
                    {items.map((skill) => (
                      <Row
                        key={skill.id}
                        checked={selectedStyleId === skill.id}
                        title={skill.title}
                        note={skill.description}
                        onClick={() => pickStyle(skill.id)}
                      />
                    ))}
                  </div>
                ))}
                {groups.length === 0 ? (
                  <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                    No styles match
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
