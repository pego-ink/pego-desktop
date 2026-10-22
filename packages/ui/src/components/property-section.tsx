import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

type PropertySectionProps = {
  title?: string;
  /** Right-aligned header control, e.g. an add/remove icon button. */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

/** Titled block of the properties panel, separated from its neighbours by a border. */
function PropertySection({ title, action, className, children }: PropertySectionProps) {
  return (
    <section data-slot="property-section" className="border-b border-border px-3 py-3">
      {title ? (
        <div className="mb-2 flex h-5 items-center justify-between">
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
          {action}
        </div>
      ) : null}
      <div className={cn("flex flex-col gap-2", className)}>{children}</div>
    </section>
  );
}

/** Two equal columns for paired fields (X/Y, W/H). */
function PropertyRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-2 gap-2", className)} {...props} />;
}

export { PropertySection, PropertyRow };
