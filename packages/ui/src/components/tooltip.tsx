import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@pego/ui/lib/utils";

/** 400ms open delay; moving to another tooltip within 300ms of a close opens it instantly. */
const OPEN_DELAY_MS = 400;
const SKIP_DELAY_MS = 300;

function TooltipProvider({
  delayDuration = OPEN_DELAY_MS,
  skipDelayDuration = SKIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

type TooltipProps = {
  /** Tooltip body. */
  content: React.ReactNode;
  /** Optional keyboard shortcut hint rendered after the content. */
  shortcut?: string;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  sideOffset?: number;
  /** The trigger element; it receives the hover and focus handlers (asChild). */
  children: React.ReactElement;
  className?: string;
};

/**
 * Small tooltip. Opens on hover (after the delay) and on keyboard focus only. Animates translate and
 * opacity over 125ms, except when it opens instantly right after another one closed. Needs a
 * `TooltipProvider` above it so the skip-delay state is shared.
 */
function Tooltip({
  content,
  shortcut,
  side = "right",
  sideOffset = 8,
  children,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md",
            "data-[side=right]:[--tt-x:-4px] data-[side=left]:[--tt-x:4px] data-[side=bottom]:[--tt-y:-4px] data-[side=top]:[--tt-y:4px]",
            "data-[state=delayed-open]:animate-[pego-tooltip-in_125ms_var(--ease-out)]",
            className,
          )}
        >
          {content}
          {shortcut ? <kbd className="font-sans opacity-60">{shortcut}</kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipProvider };
