import {
  CONNECTOR_DEFAULT_STROKE,
  findNode,
  type ConnectorNode,
  type ConnectorRoute,
  type ConnectorSide,
  type Stroke,
} from "@pego/doc";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { SegmentedControl, type SegmentedOption } from "@pego/ui/components/segmented-control";
import { useDocumentStore } from "@/store/use-document-store";
import { PropColor } from "@/panels/properties/PropColor";
import { RawNumberField } from "@/panels/properties/PropNumber";
import { FieldLabel, MarkerSelect } from "@/panels/properties/PathSection";
import { TextCommitField } from "@/panels/properties/TextCommitField";
import { useApplyProps } from "@/panels/properties/use-apply-props";

const ROUTES: readonly SegmentedOption<ConnectorRoute>[] = [
  { value: "elbow", label: "Elbow", title: "Right angles" },
  { value: "straight", label: "Straight", title: "Straight line" },
  { value: "curved", label: "Curved", title: "Curve" },
];

const SIDES: readonly { value: ConnectorSide; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
];

const SideSelect = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ConnectorSide;
  onChange: (side: ConnectorSide) => void;
}) => (
  <label className="flex min-w-0 flex-col gap-1">
    <FieldLabel>{label}</FieldLabel>
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value as ConnectorSide)}>
      {SIDES.map((side) => (
        <option key={side.value} value={side.value}>
          {side.label}
        </option>
      ))}
    </NativeSelect>
  </label>
);

/** A connector's label, route, attachment sides, line and arrows. */
export const ConnectorSection = ({ node }: { node: ConnectorNode }) => {
  const apply = useApplyProps([node]);
  const doc = useDocumentStore((s) => s.doc);
  const name = (id: string) => findNode(doc, id)?.name ?? id;
  const stroke: Stroke = node.stroke ?? CONNECTOR_DEFAULT_STROKE;
  const setStroke = (patch: Partial<Stroke>, label: string, phase?: "commit" | "extend") =>
    apply(
      (n) => ({
        stroke: { ...((n as ConnectorNode).stroke ?? CONNECTOR_DEFAULT_STROKE), ...patch },
      }),
      label,
      phase,
    );
  return (
    <PropertySection title="Connector">
      <div className="text-[13px] text-muted-foreground">
        {name(node.from.id)} → {name(node.to.id)}
      </div>
      <TextCommitField
        value={node.label ?? ""}
        label="Connector label"
        placeholder="Label (e.g. Tap Beli)"
        onCommit={(label) => apply({ label: label.trim() || null }, "Change connector label")}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel>Route</FieldLabel>
        <SegmentedControl
          aria-label="Connector route"
          value={node.route ?? "elbow"}
          options={ROUTES}
          onChange={(route) => apply({ route }, "Change connector route")}
        />
      </div>
      <PropertyRow>
        <SideSelect
          label="From side"
          value={node.from.side ?? "auto"}
          onChange={(side) => apply({ from: { ...node.from, side } }, "Change connector side")}
        />
        <SideSelect
          label="To side"
          value={node.to.side ?? "auto"}
          onChange={(side) => apply({ to: { ...node.to, side } }, "Change connector side")}
        />
      </PropertyRow>
      <PropertyRow className="grid-cols-[1fr_5.5rem]">
        <PropColor
          raw={stroke.color}
          label="Line color"
          onChange={(color, phase) => setStroke({ color }, "Change line color", phase)}
        />
        <RawNumberField
          raw={Array.isArray(stroke.width) ? undefined : (stroke.width as number | string)}
          fallback={CONNECTOR_DEFAULT_STROKE.width}
          min={0.5}
          label="W"
          labelTitle="Line width"
          onChange={(width, phase) => setStroke({ width }, "Change line width", phase)}
        />
      </PropertyRow>
      <PropertyRow>
        <MarkerSelect
          label="Start"
          value={node.startMarker ?? "none"}
          onChange={(startMarker) => apply({ startMarker }, "Change start marker")}
        />
        <MarkerSelect
          label="End"
          value={node.endMarker ?? "arrow"}
          onChange={(endMarker) => apply({ endMarker }, "Change end marker")}
        />
      </PropertyRow>
    </PropertySection>
  );
};
