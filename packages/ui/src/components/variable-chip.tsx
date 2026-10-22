import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

/** Pill showing a `$variable` binding. Click to detach it and edit a literal value. */
function VariableChip({
  name,
  className,
  ...props
}: { name: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="variable-chip"
      title={`Bound to ${name}. Click to edit as a literal.`}
      className={cn(
        "inline-flex h-5 max-w-full items-center truncate rounded-sm bg-violet/15 px-1.5 font-mono text-[11px] text-violet outline-none hover:bg-violet/25 focus-visible:ring-2 focus-visible:ring-violet/50",
        className,
      )}
      {...props}
    >
      <span className="truncate">{name}</span>
    </button>
  );
}

export { VariableChip };
