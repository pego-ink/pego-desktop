import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full resize-y rounded-md border border-transparent bg-muted px-2 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
