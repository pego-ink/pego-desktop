import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

/**
 * Small circular activity indicator. Spins with `animate-spin`; with reduced motion it stays a
 * static ring so it still reads as "busy" without movement.
 */
export const Spinner = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    role="status"
    aria-label="Loading"
    className={cn(
      "inline-block size-3.5 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin",
      className,
    )}
    {...props}
  />
);
