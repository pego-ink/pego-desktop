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
  const activeIndex = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      aria-label={props["aria-label"]}
      className={cn("relative flex h-7 w-full rounded-md bg-muted p-0.5", className)}
    >
      <span
        aria-hidden
        data-slot="segmented-control-indicator"
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-sm bg-secondary shadow-xs transition-[translate,opacity] duration-180 ease-in-out",
          activeIndex < 0 && "opacity-0",
        )}
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          translate: `${Math.max(activeIndex, 0) * 100}% 0`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "relative flex flex-1 items-center justify-center rounded-sm text-xs text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
            option.value === value && "text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { SegmentedControl, type SegmentedOption };
