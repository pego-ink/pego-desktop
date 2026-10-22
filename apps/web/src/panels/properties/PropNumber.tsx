import { resolveNumber, type PegoNode } from "@pego/doc";
import { NumberField, type NumberFieldProps } from "@pego/ui/components/number-field";
import { useDocumentStore } from "@/store/use-document-store";
import { commonValue } from "@/panels/mixed-value";
import { rawProp, variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type FieldPassthrough = Omit<NumberFieldProps, "value" | "variable" | "mixed" | "onChange">;

type RawNumberFieldProps = FieldPassthrough & {
  /** Stored value: number, `$variable` or unset. */
  raw: number | string | undefined;
  mixed?: boolean;
  /** Shown and used for scrubbing when unset. */
  fallback?: number;
  onChange: NumberFieldProps["onChange"];
};

/** Number field over a stored value that may be a `$variable`. */
export const RawNumberField = ({
  raw,
  mixed = false,
  fallback = 0,
  ...field
}: RawNumberFieldProps) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  return (
    <NumberField
      {...field}
      mixed={mixed}
      variable={variableOf(raw)}
      value={mixed ? undefined : resolveNumber(raw, variables, fallback)}
    />
  );
};

type PropNumberProps = FieldPassthrough & {
  nodes: readonly PegoNode[];
  propKey: string;
  fallback?: number;
  /** Undo label, e.g. "Change X". */
  history: string;
};

/** Number field bound to one numeric prop of every selected node. */
export const PropNumber = ({ nodes, propKey, fallback, history, ...field }: PropNumberProps) => {
  const apply = useApplyProps(nodes);
  const common = commonValue(nodes.map((node) => rawProp(node, propKey)));
  return (
    <RawNumberField
      {...field}
      fallback={fallback}
      mixed={common.kind === "mixed"}
      raw={common.kind === "same" ? (common.value as number | string | undefined) : undefined}
      onChange={(value, phase) => apply({ [propKey]: value }, history, phase)}
    />
  );
};
