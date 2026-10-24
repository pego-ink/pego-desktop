import { useRef, type KeyboardEvent } from "react";
import { Input } from "@pego/ui/components/input";
import { cn } from "@pego/ui/lib/utils";
import {
  AGENT_NAME_SET_IDS,
  AGENT_NAME_SETS,
  agentNames,
  clipAgentName,
  fallbackAgentName,
  MAX_AGENT_NAME_LENGTH,
  type AgentNameSet,
} from "@/agent/agent-names";
import { runColor } from "@/agent/run-colors";
import { useSettingsStore } from "@/store/use-settings-store";
import { SettingsSection } from "./SettingRow";
import { moveTabFocus } from "./tab-nav";

const SET_OPTIONS = AGENT_NAME_SET_IDS.map((id) => ({
  value: id,
  label: id === "custom" ? "Custom" : AGENT_NAME_SETS[id].label,
})) satisfies { value: AgentNameSet; label: string }[];

const slotNumber = (index: number) => String(index + 1).padStart(2, "0");

/** The set picker: one button per set, each as wide as its name (arrow keys move between them). */
const NameSetPicker = ({
  value,
  onChange,
}: {
  value: AgentNameSet;
  onChange: (set: AgentNameSet) => void;
}) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = SET_OPTIONS.findIndex((option) => option.value === value);
    const next = moveTabFocus(current, event.key, SET_OPTIONS.length);
    const option = next === null ? undefined : SET_OPTIONS[next];
    if (!option || next === null) return;
    event.preventDefault();
    onChange(option.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Name set"
      onKeyDown={onKeyDown}
      className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {SET_OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50",
              checked && "bg-violet-soft text-violet-text hover:text-violet-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Settings › Agent names: which names the agents' canvas cursors carry. Agents take the slots in
 * order (the first free one), each with its color; "Custom" makes every name editable.
 */
export const AgentNamesSettingsTab = () => {
  const set = useSettingsStore((s) => s.agentNameSet);
  const custom = useSettingsStore((s) => s.customAgentNames);
  const update = useSettingsStore((s) => s.update);
  const names = agentNames(set, custom);

  const rename = (index: number, value: string) =>
    update({
      customAgentNames: custom.map((name, slot) => (slot === index ? clipAgentName(value) : name)),
    });

  return (
    <div>
      <p className="mb-5 text-xs text-muted-foreground">
        Up to three agents can work at once. Each takes the first free name below, with its color,
        and keeps it for its chat while it is free; the name shows on its cursor. With Pego, all of
        them are called Pego and told apart by color.
      </p>
      <SettingsSection title="Name set">
        <NameSetPicker value={set} onChange={(next) => update({ agentNameSet: next })} />
      </SettingsSection>
      <ol aria-label="Agent names" className="divide-y divide-border">
        {names.map((name, index) => (
          <li key={index} className="flex h-10 items-center gap-3">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: runColor(index) }}
            />
            {set === "custom" ? (
              <Input
                aria-label={`Name ${slotNumber(index)}`}
                value={custom[index] ?? ""}
                placeholder={fallbackAgentName(index)}
                maxLength={MAX_AGENT_NAME_LENGTH}
                onChange={(event) => rename(index, event.target.value)}
                className="h-7 max-w-64 text-[13px]"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{name}</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {slotNumber(index)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
