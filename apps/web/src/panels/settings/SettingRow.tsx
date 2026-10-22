import { useId, type ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  /** Receives the id to put on the control's `aria-labelledby`. */
  children: (ids: { labelId: string; descriptionId: string | undefined }) => ReactNode;
};

/** One settings row: title and hint on the leading edge, the control on the trailing edge. */
export const SettingRow = ({ title, description, children }: Props) => {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div id={labelId} className="text-sm text-foreground">
          {title}
        </div>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        {children({ labelId, descriptionId: description ? descriptionId : undefined })}
      </div>
    </div>
  );
};

/** Group heading + rows; spacing, not rules, separates groups. */
export const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-6 last:mb-0">
    <h3 className="mb-1 text-xs font-medium text-muted-foreground">{title}</h3>
    <div>{children}</div>
  </section>
);
