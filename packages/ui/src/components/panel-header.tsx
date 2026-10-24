import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

/** Title bar of a side panel. Extra children are right-aligned (actions). */
function PanelHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-[15px] font-semibold text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { PanelHeader };
