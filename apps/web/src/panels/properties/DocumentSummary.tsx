import type { PegoDocument } from "@pego/doc";
import { PropertySection } from "@pego/ui/components/property-section";

const VariableValue = ({ variable }: { variable: PegoDocument["variables"][string] }) =>
  variable.type === "color" ? (
    <span className="flex items-center gap-1.5 font-mono">
      <span
        aria-hidden
        className="size-3 rounded-[3px] border border-border"
        style={{ background: variable.value }}
      />
      {variable.value.toUpperCase()}
    </span>
  ) : (
    <span className="truncate font-mono">{String(variable.value)}</span>
  );

/** Shown when nothing is selected: document name and its variables (read-only). */
export const DocumentSummary = ({ doc }: { doc: PegoDocument }) => {
  const variables = Object.entries(doc.variables);
  return (
    <>
      <PropertySection title="Document">
        <p className="truncate text-xs text-foreground">{doc.name}</p>
        <p className="text-[11px] text-muted-foreground">Select a layer to edit its properties.</p>
      </PropertySection>
      <PropertySection title="Variables">
        {variables.length === 0 ? (
          <p className="text-xs text-muted-foreground">No variables defined.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {variables.map(([name, variable]) => (
              <li key={name} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-violet">${name}</span>
                <span className="shrink-0 text-muted-foreground">
                  <VariableValue variable={variable} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </PropertySection>
    </>
  );
};
