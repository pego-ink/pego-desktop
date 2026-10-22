import { MinusIcon, PlusIcon, SquareDashedIcon } from "lucide-react";
import type { PegoNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { PropColor } from "@/panels/properties/PropColor";
import { PropNumber, RawNumberField } from "@/panels/properties/PropNumber";
import {
  DEFAULT_FILL,
  DEFAULT_STROKE,
  hasCornerRadius,
  rawProp,
} from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

const SectionButton = ({
  label,
  onClick,
  remove,
}: {
  label: string;
  onClick: () => void;
  remove?: boolean;
}) => (
  <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick}>
    {remove ? <MinusIcon /> : <PlusIcon />}
  </Button>
);

export const AppearanceSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  if (!hasCornerRadius(node)) return null;
  return (
    <PropertySection title="Appearance">
      <PropertyRow>
        <PropNumber
          nodes={[node]}
          propKey="cornerRadius"
          label={<SquareDashedIcon />}
          labelTitle="Corner radius"
          min={0}
          history="Change corner radius"
        />
        {node.type === "frame" ? (
          <label className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={node.clip === true}
              onChange={(event) => apply({ clip: event.target.checked }, "Toggle clip")}
            />
            Clip content
          </label>
        ) : null}
      </PropertyRow>
    </PropertySection>
  );
};

export const FillSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const fill = rawProp(node, "fill") as string | undefined;
  return (
    <PropertySection
      title="Fill"
      action={
        fill === undefined ? (
          <SectionButton
            label="Add fill"
            onClick={() => apply({ fill: DEFAULT_FILL }, "Add fill")}
          />
        ) : (
          <SectionButton
            label="Remove fill"
            remove
            onClick={() => apply({ fill: null }, "Remove fill")}
          />
        )
      }
    >
      {fill === undefined ? null : (
        <PropColor
          raw={fill}
          label="Fill color"
          onChange={(value, phase) => apply({ fill: value }, "Change fill", phase)}
        />
      )}
    </PropertySection>
  );
};

type Stroke = { color: string; width: number | string };

export const StrokeSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const stroke = rawProp(node, "stroke") as Stroke | undefined;
  return (
    <PropertySection
      title="Stroke"
      action={
        stroke === undefined ? (
          <SectionButton
            label="Add stroke"
            onClick={() => apply({ stroke: DEFAULT_STROKE }, "Add stroke")}
          />
        ) : (
          <SectionButton
            label="Remove stroke"
            remove
            onClick={() => apply({ stroke: null }, "Remove stroke")}
          />
        )
      }
    >
      {stroke === undefined ? null : (
        <PropertyRow className="grid-cols-[1fr_5.5rem]">
          <PropColor
            raw={stroke.color}
            label="Stroke color"
            onChange={(color, phase) =>
              apply(
                (n) => ({ stroke: { ...(rawProp(n, "stroke") as Stroke), color } }),
                "Change stroke",
                phase,
              )
            }
          />
          <StrokeWidth node={node} />
        </PropertyRow>
      )}
    </PropertySection>
  );
};

/** Stroke width lives inside the `stroke` object, so it needs its own update shape. */
const StrokeWidth = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const stroke = rawProp(node, "stroke") as Stroke;
  return (
    <RawNumberField
      raw={stroke.width}
      fallback={1}
      min={0}
      label="W"
      labelTitle="Stroke width"
      onChange={(width, phase) =>
        apply(
          (n) => ({ stroke: { ...(rawProp(n, "stroke") as Stroke), width } }),
          "Change stroke width",
          phase,
        )
      }
    />
  );
};
