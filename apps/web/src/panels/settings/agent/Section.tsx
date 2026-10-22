import type { ReactNode } from "react";
import { cn } from "@pego/ui/lib/utils";

type SectionProps = {
  /** Deep-link id (`openSettings("agent", id)`). */
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Briefly highlighted after a deep link scrolled here. */
  flashing?: boolean;
  children: ReactNode;
};

/** One titled block of the Agent & Models page. */
export const Section = ({ id, title, description, action, flashing, children }: SectionProps) => (
  <section
    data-section={id}
    aria-labelledby={`agent-settings-${id}`}
    className={cn(
      "-mx-2 grid scroll-mt-2 gap-3 rounded-lg px-2 py-2 transition-[background-color,box-shadow] duration-500 ease-out",
      flashing && "bg-accent/50 ring-1 ring-ring/40",
    )}
  >
    <div className="flex items-start gap-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h3 id={`agent-settings-${id}`} className="text-sm font-medium">
          {title}
        </h3>
        {description ? (
          <p className="text-xs leading-4 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
    {children}
  </section>
);
