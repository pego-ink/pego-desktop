import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

/** Styled native `<select>`: keeps keyboard and a11y behaviour of the platform control. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select" className="relative w-full min-w-0">
      <select
        className={cn(
          "h-7 w-full min-w-0 appearance-none rounded-md border border-transparent bg-muted pr-6 pl-2 text-xs text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </div>
  );
}

export { NativeSelect };
