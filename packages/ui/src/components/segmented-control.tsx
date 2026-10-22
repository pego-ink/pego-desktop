import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  title?: string;
};

type SegmentedControlProps<T extends string> = {
  value: T | undefined;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
};

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      aria-label={props["aria-label"]}
      className={cn("flex h-7 w-full rounded-md bg-muted p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex flex-1 items-center justify-center rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
            option.value === value && "bg-secondary text-foreground shadow-xs",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { SegmentedControl, type SegmentedOption };
