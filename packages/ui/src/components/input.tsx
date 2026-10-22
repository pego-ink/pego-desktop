import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-transparent bg-muted px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
