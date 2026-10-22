import { useState } from "react";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "lucide-react";
import { findNode, resolveString, type IconNode, type RefNode, type TextNode } from "@pego/doc";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { SegmentedControl, type SegmentedOption } from "@pego/ui/components/segmented-control";
import { VariableChip } from "@pego/ui/components/variable-chip";
import { useDocumentStore } from "@/store/use-document-store";
import { PropNumber } from "@/panels/properties/PropNumber";
import { TextCommitArea, TextCommitField } from "@/panels/properties/TextCommitField";
import { variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type TextAlign = NonNullable<TextNode["textAlign"]>;

const ALIGN_OPTIONS: readonly SegmentedOption<TextAlign>[] = [
  { value: "left", label: <AlignLeftIcon />, title: "Align left" },
  { value: "center", label: <AlignCenterIcon />, title: "Align center" },
  { value: "right", label: <AlignRightIcon />, title: "Align right" },
];

const WEIGHTS: readonly [number, string][] = [
  [100, "Thin"],
  [200, "Extra Light"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semi Bold"],
  [700, "Bold"],
  [800, "Extra Bold"],
  [900, "Black"],
];

export const TextSection = ({ node }: { node: TextNode }) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  const apply = useApplyProps([node]);
  const [editingVariable, setEditingVariable] = useState(false);
  const contentVariable = variableOf(node.content);
  const weight = node.fontWeight ?? 400;
  const weightVariable = variableOf(weight);
  const knownWeight = typeof weight === "number" && WEIGHTS.some(([value]) => value === weight);

  return (
    <PropertySection title="Text">
      {contentVariable && !editingVariable ? (
        <div className="flex min-h-7 items-center">
          <VariableChip name={contentVariable} onClick={() => setEditingVariable(true)} />
        </div>
      ) : (
        <TextCommitArea
          value={contentVariable ? resolveString(node.content, variables) : node.content}
          label="Text content"
          onCommit={(content) => {
            setEditingVariable(false);
            apply({ content }, "Change text");
          }}
        />
      )}
      <TextCommitField
        value={node.fontFamily ?? ""}
        label="Font family"
        placeholder="Font family"
        onCommit={(fontFamily) =>
          apply({ fontFamily: fontFamily.trim() || null }, "Change font family")
        }
      />
      <PropertyRow>
        <PropNumber
          nodes={[node]}
          propKey="fontSize"
          fallback={14}
          label="Aa"
          labelTitle="Font size"
          min={1}
          history="Change font size"
        />
        <NativeSelect
          aria-label="Font weight"
          value={String(weight)}
          onChange={(event) =>
            apply({ fontWeight: Number(event.target.value) }, "Change font weight")
          }
        >
          {weightVariable ? <option value={weightVariable}>{weightVariable}</option> : null}
          {!knownWeight && !weightVariable ? (
            <option value={String(weight)}>{String(weight)}</option>
          ) : null}
          {WEIGHTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </PropertyRow>
      <SegmentedControl
        aria-label="Text alignment"
        value={node.textAlign ?? "left"}
        options={ALIGN_OPTIONS}
        onChange={(textAlign) => apply({ textAlign }, "Change text alignment")}
      />
    </PropertySection>
  );
};

export const IconSection = ({ node }: { node: IconNode }) => {
  const apply = useApplyProps([node]);
  return (
    <PropertySection title="Icon">
      <TextCommitField
        value={node.iconName}
        label="Icon name"
        placeholder="Icon name"
        onCommit={(iconName) => {
          const next = iconName.trim();
          if (next) apply({ iconName: next }, "Change icon");
        }}
      />
    </PropertySection>
  );
};

export const RefSection = ({ node }: { node: RefNode }) => {
  const target = useDocumentStore((s) => findNode(s.doc, node.ref));
  return (
    <PropertySection title="Component">
      <div className="flex h-7 items-center rounded-md bg-muted px-2 text-xs text-violet">
        <span className="truncate">
          {target ? (target.name ?? target.type) : `Missing (${node.ref})`}
        </span>
      </div>
    </PropertySection>
  );
};
