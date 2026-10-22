import * as React from "react";
import { parseHex, toColorInputValue } from "@pego/ui/lib/color";
import { cn } from "@pego/ui/lib/utils";
import { VariableChip } from "@pego/ui/components/variable-chip";

type ColorFieldProps = {
  /** Resolved `#hex`; undefined when mixed or unset. */
  value: string | undefined;
  variable?: string;
  mixed?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** "commit" starts an undo step, "extend" folds into the last one (picker dragging). */
  onChange: (value: string, phase: "commit" | "extend") => void;
  children?: React.ReactNode;
};

function ColorField({
  value,
  variable,
  mixed = false,
  disabled,
  className,
  onChange,
  children,
  ...props
}: ColorFieldProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [editingVariable, setEditingVariable] = React.useState(false);
  const cancelled = React.useRef(false);
  const pickerActive = React.useRef(false);
  const shownHex = value?.replace("#", "").toUpperCase() ?? "";

  const finish = () => {
    setEditingVariable(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    setDraft(null);
    const parsed = parseHex(draft);
    if (!parsed) return;
    if (!variable && parsed === value?.toUpperCase()) return;
    onChange(parsed, "commit");
  };

  const showChip = variable !== undefined && !editingVariable && draft === null;

  return (
    <div
      data-slot="color-field"
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 rounded-md border border-transparent bg-muted pl-1.5 transition-colors focus-within:border-ring hover:border-border",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <label
        className="relative size-4 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border border-border"
        style={{ background: mixed || !value ? undefined : value }}
      >
        <input
          type="color"
          aria-label={props["aria-label"] ?? "Pick color"}
          value={toColorInputValue(value)}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase(), pickerActive.current ? "extend" : "commit");
            pickerActive.current = true;
          }}
          onBlur={() => {
            pickerActive.current = false;
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {showChip ? (
        <VariableChip name={variable} onClick={() => setEditingVariable(true)} />
      ) : (
        <input
          autoFocus={editingVariable}
          value={draft ?? (mixed ? "" : shownHex)}
          placeholder={mixed ? "Mixed" : "None"}
          disabled={disabled}
          spellCheck={false}
          onFocus={(event) => {
            setDraft(mixed ? "" : shownHex);
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
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground uppercase outline-none placeholder:text-muted-foreground placeholder:normal-case"
        />
      )}
      {children}
    </div>
  );
}

export { ColorField, type ColorFieldProps };
