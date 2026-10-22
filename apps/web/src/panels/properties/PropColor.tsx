import type { ReactNode } from "react";
import { resolveColor } from "@pego/doc";
import { ColorField } from "@pego/ui/components/color-field";
import { useDocumentStore } from "@/store/use-document-store";
import { variableOf } from "@/panels/properties/node-props";

type PropColorProps = {
  /** Raw stored color (hex or `$variable`). */
  raw: string | undefined;
  label: string;
  onChange: (value: string, phase: "commit" | "extend") => void;
  children?: ReactNode;
};

export const PropColor = ({ raw, label, onChange, children }: PropColorProps) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  return (
    <ColorField
      aria-label={label}
      value={resolveColor(raw, variables)}
      variable={variableOf(raw)}
      onChange={onChange}
    >
      {children}
    </ColorField>
  );
};
