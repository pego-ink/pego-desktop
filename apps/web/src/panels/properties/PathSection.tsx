import type { PathNode } from "@pego/doc";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { SegmentedControl, type SegmentedOption } from "@pego/ui/components/segmented-control";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type Cap = NonNullable<PathNode["strokeCap"]>;
type Join = NonNullable<PathNode["strokeJoin"]>;
type Marker = NonNullable<PathNode["startMarker"]>;

const CAP_OPTIONS: readonly SegmentedOption<Cap>[] = [
  { value: "butt", label: "Butt", title: "Butt cap" },
  { value: "round", label: "Round", title: "Round cap" },
  { value: "square", label: "Square", title: "Square cap" },
];

const JOIN_OPTIONS: readonly SegmentedOption<Join>[] = [
  { value: "miter", label: "Miter", title: "Miter join" },
  { value: "round", label: "Round", title: "Round join" },
  { value: "bevel", label: "Bevel", title: "Bevel join" },
];

const MARKERS: readonly { value: Marker; label: string }[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "bar", label: "Bar" },
];

export const FieldLabel = ({ children }: { children: string }) => (
  <span className="text-xs text-muted-foreground">{children}</span>
);

export const MarkerSelect = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Marker;
  onChange: (value: Marker) => void;
}) => (
  <label className="flex min-w-0 flex-col gap-1">
    <FieldLabel>{label}</FieldLabel>
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value as Marker)}>
      {MARKERS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </NativeSelect>
  </label>
);

export const PathSection = ({ node }: { node: PathNode }) => {
  const apply = useApplyProps([node]);
  return (
    <PropertySection title="Stroke details">
      <div className="flex flex-col gap-1">
        <FieldLabel>Cap</FieldLabel>
        <SegmentedControl
          aria-label="Stroke cap"
          value={node.strokeCap ?? "butt"}
          options={CAP_OPTIONS}
          onChange={(strokeCap) => apply({ strokeCap }, "Change stroke cap")}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Join</FieldLabel>
        <SegmentedControl
          aria-label="Stroke join"
          value={node.strokeJoin ?? "miter"}
          options={JOIN_OPTIONS}
          onChange={(strokeJoin) => apply({ strokeJoin }, "Change stroke join")}
        />
      </div>
      <PropertyRow>
        <MarkerSelect
          label="Start"
          value={node.startMarker ?? "none"}
          onChange={(startMarker) => apply({ startMarker }, "Change start marker")}
        />
        <MarkerSelect
          label="End"
          value={node.endMarker ?? "none"}
          onChange={(endMarker) => apply({ endMarker }, "Change end marker")}
        />
      </PropertyRow>
    </PropertySection>
  );
};
