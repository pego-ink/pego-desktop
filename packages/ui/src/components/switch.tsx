import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@pego/ui/lib/utils";

/** Compact on/off toggle (role="switch"). Label it with `aria-label` or a wrapping label. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted outline-none transition-colors duration-(--duration-fast) ease-out hover:border-border focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 translate-x-[3px] rounded-full bg-muted-foreground transition-[translate,background-color] duration-(--duration-fast) ease-out data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
