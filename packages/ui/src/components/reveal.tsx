import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

type RevealProps = {
  show: boolean;
  /** Applied to the inner content wrapper (e.g. bottom padding that should collapse with it). */
  className?: string;
  children: React.ReactNode;
};

/**
 * Mounts and unmounts content with a grid-template-rows 0fr -> 1fr height transition (200ms) plus a
 * fade, so neighbours glide instead of snapping. The last non-empty children are kept while
 * collapsing. The initial state is applied without animation. Collapsed content is `inert`.
 */
function Reveal({ show, className, children }: RevealProps) {
  const [rendered, setRendered] = React.useState(show);
  const [expanded, setExpanded] = React.useState(show);
  const [kept, setKept] = React.useState(children);

  if (show && kept !== children) setKept(children);

  if (show && !rendered) setRendered(true);

  React.useEffect(() => {
    if (!show) return;
    // Wait one frame so the collapsed state paints first and the transition has a start value.
    const frame = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(frame);
  }, [show]);

  const open = show && expanded;
  if (!rendered) return null;
  return (
    <div
      data-slot="reveal"
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || show) return;
        setRendered(false);
        setExpanded(false);
      }}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-(--duration-base) ease-out motion-reduce:transition-opacity",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", className)}>{show ? children : kept}</div>
    </div>
  );
}

export { Reveal };
