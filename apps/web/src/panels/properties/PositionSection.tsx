import { ChevronDownIcon, RotateCwIcon, SunIcon } from "lucide-react";
import { resolveNumber, type PegoNode } from "@pego/doc";
import { NumberField } from "@pego/ui/components/number-field";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { useDocumentStore } from "@/store/use-document-store";
import { commonValue } from "@/panels/mixed-value";
import { PropNumber } from "@/panels/properties/PropNumber";
import { rawProp, variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type SizeMode = "fixed" | "fill" | "fit";
const FALLBACK_SIZE = 100;

const SIZE_MODES: Record<string, SizeMode> = { fill_container: "fill", fit_content: "fit" };
const SIZE_VALUES: Record<Exclude<SizeMode, "fixed">, string> = {
  fill: "fill_container",
  fit: "fit_content",
};

/** Width/height: a number, or fill_container / fit_content picked from the trailing select. */
const SizeField = ({
  nodes,
  propKey,
  label,
}: {
  nodes: readonly PegoNode[];
  propKey: "width" | "height";
  label: string;
}) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  const apply = useApplyProps(nodes);
  const common = commonValue(nodes.map((node) => rawProp(node, propKey)));
  const mixed = common.kind === "mixed";
  const raw = common.kind === "same" ? common.value : undefined;
  const mode: SizeMode = (typeof raw === "string" && SIZE_MODES[raw]) || "fixed";
  const numeric =
    mode === "fixed" && raw !== undefined
      ? resolveNumber(raw as number | string, variables, FALLBACK_SIZE)
      : undefined;
  const history = `Change ${label === "W" ? "width" : "height"}`;

  return (
    <NumberField
      label={label}
      labelTitle={history}
      mixed={mixed}
      variable={variableOf(raw)}
      value={numeric}
      min={0}
      placeholder="Auto"
      display={mode === "fill" ? "Fill" : mode === "fit" ? "Hug" : undefined}
      onChange={(value, phase) => apply({ [propKey]: value }, history, phase)}
    >
      <span className="relative flex h-full w-6 shrink-0 items-center justify-center text-muted-foreground">
        <ChevronDownIcon aria-hidden className="pointer-events-none size-3" />
        <select
          aria-label={`${history} mode`}
          value={mixed ? "" : mode}
          onChange={(event) => {
            const next = event.target.value as SizeMode;
            apply(
              { [propKey]: next === "fixed" ? (numeric ?? FALLBACK_SIZE) : SIZE_VALUES[next] },
              history,
            );
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {mixed ? <option value="" hidden /> : null}
          <option value="fixed">Fixed</option>
          <option value="fill">Fill container</option>
          <option value="fit">Fit content</option>
        </select>
      </span>
    </NumberField>
  );
};

export const PositionSection = ({ nodes }: { nodes: readonly PegoNode[] }) => {
  const single = nodes.length === 1;
  return (
    <PropertySection>
      <PropertyRow>
        <PropNumber nodes={nodes} propKey="x" label="X" labelTitle="Scrub X" history="Change X" />
        <PropNumber nodes={nodes} propKey="y" label="Y" labelTitle="Scrub Y" history="Change Y" />
      </PropertyRow>
      <PropertyRow>
        <SizeField nodes={nodes} propKey="width" label="W" />
        <SizeField nodes={nodes} propKey="height" label="H" />
      </PropertyRow>
      {single ? (
        <PropertyRow>
          <PropNumber
            nodes={nodes}
            propKey="rotation"
            label={<RotateCwIcon />}
            labelTitle="Rotation"
            suffix="°"
            history="Change rotation"
          />
          <PropNumber
            nodes={nodes}
            propKey="opacity"
            label={<SunIcon />}
            labelTitle="Opacity"
            fallback={1}
            scale={100}
            min={0}
            max={100}
            suffix="%"
            history="Change opacity"
          />
        </PropertyRow>
      ) : null}
    </PropertySection>
  );
};
