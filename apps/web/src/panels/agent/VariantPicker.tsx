import { CheckIcon, CopyIcon } from "lucide-react";
import { MAX_VARIANTS, type VariantMode } from "@pego/agent";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { cn } from "@pego/ui/lib/utils";

export type Variants = { count: number; mode: VariantMode };

const MODES: { value: VariantMode; label: string; hint: string }[] = [
  { value: "any", label: "Any difference", hint: "Layout, style or both" },
  { value: "style", label: "Style", hint: "Same idea, different look" },
  { value: "layout", label: "Layout", hint: "Same look, different structure" },
];

/**
 * How many agents work on the next prompt, each in its own chat with a distinct take, and how
 * their results should differ. Goes back to one after each send.
 */
export const VariantPicker = ({
  value,
  onChange,
}: {
  value: Variants;
  onChange: (next: Variants) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`Variants: ${value.count}`}
        title="Variants: several agents, one take each"
        className={cn(
          "flex h-6 shrink-0 items-center gap-1 rounded-lg border border-border bg-background/60 px-2 font-mono text-xs text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          value.count > 1 &&
            "border-transparent bg-violet-soft text-violet-text hover:bg-violet-soft hover:text-violet-text",
        )}
      >
        <CopyIcon aria-hidden className="size-3.5" />
        {value.count}×
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" onCloseAutoFocus={(event) => event.preventDefault()}>
      {Array.from({ length: MAX_VARIANTS }, (_, index) => index + 1).map((count) => (
        <DropdownMenuItem key={count} onSelect={() => onChange({ ...value, count })}>
          <CheckIcon aria-hidden className={cn("size-3.5", count !== value.count && "invisible")} />
          {count === 1 ? "One take" : `${count} variants`}
        </DropdownMenuItem>
      ))}
      <div role="separator" className="-mx-1 my-1 h-px bg-border" />
      {MODES.map((mode) => (
        <DropdownMenuItem
          key={mode.value}
          disabled={value.count === 1}
          onSelect={() => onChange({ ...value, mode: mode.value })}
        >
          <CheckIcon
            aria-hidden
            className={cn("size-3.5", mode.value !== value.mode && "invisible")}
          />
          <span className="flex flex-col">
            <span>{mode.label}</span>
            <span className="text-xs text-muted-foreground">{mode.hint}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
