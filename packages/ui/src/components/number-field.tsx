import * as React from "react";
import { useScrub } from "@pego/ui/hooks/use-scrub";
import { clampNumber, formatNumber, parseNumber, roundTo } from "@pego/ui/lib/parse-number";
import { cn } from "@pego/ui/lib/utils";
import { VariableChip } from "@pego/ui/components/variable-chip";

type NumberFieldProps = {
  /** Scrub handle: drag horizontally to change the value (shift = x10). */
  label: React.ReactNode;
  labelTitle?: string;
  /** Resolved value in stored units; undefined renders empty. */
  value: number | undefined;
  /** `$name` when the stored value is a variable: shown as a chip until edited. */
  variable?: string;
  mixed?: boolean;
  /** Display = stored * scale (opacity: stored 0..1, shown 0..100). */
  scale?: number;
  /** Bounds in display units. */
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  /** Text shown instead of the number, e.g. "Fill" for `fill_container`. */
  display?: string;
  disabled?: boolean;
  className?: string;
  /** Receives stored units. "commit" starts an undo step, "extend" folds into the last one. */
  onChange: (value: number, phase: "commit" | "extend") => void;
  children?: React.ReactNode;
};

function NumberField({
  label,
  labelTitle,
  value,
  variable,
  mixed = false,
  scale = 1,
  min,
  max,
  step = 1,
  suffix = "",
  placeholder,
  display,
  disabled,
  className,
  onChange,
  children,
}: NumberFieldProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [editingVariable, setEditingVariable] = React.useState(false);
  const cancelled = React.useRef(false);
  const bounds = { min, max };
  const shown = value === undefined ? undefined : roundTo(value * scale, 2);

  const scrub = useScrub({
    getValue: () => shown ?? 0,
    step,
    onChange: (next, phase) => onChange(roundTo(clampNumber(next, bounds) / scale), phase),
  });

  const finish = () => {
    setEditingVariable(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    setDraft(null);
    const parsed = parseNumber(draft, bounds);
    if (parsed === null) return;
    if (!variable && !mixed && parsed === shown) return;
    onChange(roundTo(parsed / scale), "commit");
  };

  const idleText = mixed
    ? ""
    : (display ?? (shown === undefined ? "" : `${formatNumber(shown)}${suffix}`));
  const showChip = variable !== undefined && !editingVariable && draft === null;

  return (
    <div
      data-slot="number-field"
      className={cn(
        "flex h-7 min-w-0 items-center rounded-md border border-transparent bg-muted transition-colors focus-within:border-ring hover:border-border",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        {...scrub}
        title={labelTitle}
        className="flex h-full w-6 shrink-0 cursor-ew-resize touch-none items-center justify-center font-mono text-[11px] text-subtle-foreground select-none [&_svg]:size-3"
      >
        {label}
      </span>
      {showChip ? (
        <VariableChip name={variable} onClick={() => setEditingVariable(true)} />
      ) : (
        <input
          autoFocus={editingVariable}
          value={draft ?? idleText}
          placeholder={mixed ? "Mixed" : placeholder}
          disabled={disabled}
          inputMode="decimal"
          spellCheck={false}
          onFocus={(event) => {
            setDraft(shown === undefined || mixed ? "" : formatNumber(shown));
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent pr-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      )}
      {children}
    </div>
  );
}

export { NumberField, type NumberFieldProps };
