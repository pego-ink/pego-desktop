import {
  ArrowDownIcon,
  ArrowRightIcon,
  MoveHorizontalIcon,
  MoveVerticalIcon,
  XIcon,
} from "lucide-react";
import { resolveNumber, type FrameNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { SegmentedControl, type SegmentedOption } from "@pego/ui/components/segmented-control";
import { useDocumentStore } from "@/store/use-document-store";
import { PropNumber, RawNumberField } from "@/panels/properties/PropNumber";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type LayoutMode = NonNullable<FrameNode["layout"]>;

const LAYOUT_OPTIONS: readonly SegmentedOption<LayoutMode>[] = [
  { value: "none", label: <XIcon />, title: "No auto layout" },
  { value: "horizontal", label: <ArrowRightIcon />, title: "Horizontal" },
  { value: "vertical", label: <ArrowDownIcon />, title: "Vertical" },
];

const JUSTIFY_OPTIONS = [
  ["start", "Start"],
  ["center", "Center"],
  ["end", "End"],
  ["space_between", "Space between"],
  ["space_around", "Space around"],
] as const;
const ALIGN_OPTIONS = [
  ["start", "Start"],
  ["center", "Center"],
  ["end", "End"],
] as const;
const SIDES = ["T", "R", "B", "L"] as const;
const SIDE_TITLES = ["Top", "Right", "Bottom", "Left"] as const;

const Caption = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1 font-mono text-[10px] tracking-wider text-subtle-foreground uppercase">
    {text}
    {children}
  </label>
);

export const LayoutSection = ({ node }: { node: FrameNode }) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  const apply = useApplyProps([node]);
  const layout = node.layout ?? "none";
  const { padding } = node;
  const split = Array.isArray(padding);

  const togglePadding = () => {
    if (Array.isArray(padding)) {
      const sides = padding.map((p) => resolveNumber(p, variables, 0));
      const uniform = sides.every((p) => p === sides[0]);
      apply({ padding: uniform ? (sides[0] ?? 0) : (padding[0] ?? 0) }, "Change padding");
      return;
    }
    const all = resolveNumber(padding, variables, 0);
    apply({ padding: [all, all, all, all] }, "Change padding");
  };

  return (
    <PropertySection title="Layout">
      <SegmentedControl
        aria-label="Layout direction"
        value={layout}
        options={LAYOUT_OPTIONS}
        onChange={(value) => apply({ layout: value }, "Change layout")}
      />
      {layout === "none" ? null : (
        <>
          <PropertyRow>
            <PropNumber
              nodes={[node]}
              propKey="gap"
              label={layout === "horizontal" ? <MoveHorizontalIcon /> : <MoveVerticalIcon />}
              labelTitle="Gap"
              min={0}
              history="Change gap"
            />
            {split ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[13px] text-muted-foreground"
                onClick={togglePadding}
              >
                Uniform padding
              </Button>
            ) : (
              <div className="flex gap-1">
                <PropNumber
                  nodes={[node]}
                  propKey="padding"
                  label="P"
                  labelTitle="Padding"
                  min={0}
                  history="Change padding"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 font-mono text-[11px]"
                  title="Set each side separately"
                  onClick={togglePadding}
                >
                  4
                </Button>
              </div>
            )}
          </PropertyRow>
          {split ? (
            <PropertyRow>
              {SIDES.map((side, index) => (
                <RawNumberField
                  key={side}
                  raw={padding[index]}
                  min={0}
                  label={side}
                  labelTitle={`${SIDE_TITLES[index]} padding`}
                  onChange={(value, phase) => {
                    const next = [...padding];
                    next[index] = value;
                    apply({ padding: next }, "Change padding", phase);
                  }}
                />
              ))}
            </PropertyRow>
          ) : null}
          <PropertyRow>
            <Caption text="Justify">
              <NativeSelect
                value={node.justifyContent ?? "start"}
                onChange={(event) =>
                  apply({ justifyContent: event.target.value }, "Change justify")
                }
              >
                {JUSTIFY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Caption>
            <Caption text="Align">
              <NativeSelect
                value={node.alignItems ?? "start"}
                onChange={(event) => apply({ alignItems: event.target.value }, "Change align")}
              >
                {ALIGN_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Caption>
          </PropertyRow>
        </>
      )}
    </PropertySection>
  );
};
