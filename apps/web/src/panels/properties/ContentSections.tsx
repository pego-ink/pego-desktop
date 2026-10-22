import { useState } from "react";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "lucide-react";
import { findNode, resolveString, type IconNode, type RefNode, type TextNode } from "@pego/doc";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { SegmentedControl, type SegmentedOption } from "@pego/ui/components/segmented-control";
import { VariableChip } from "@pego/ui/components/variable-chip";
import { useDocumentStore } from "@/store/use-document-store";
import { PropNumber } from "@/panels/properties/PropNumber";
import { TextCommitArea, TextCommitField } from "@/panels/properties/TextCommitField";
import { commonValue } from "@/panels/mixed-value";
import { FontFamilyField } from "@/panels/properties/font/FontFamilyField";
import { FontStyleControls } from "@/panels/properties/font/FontStyleControls";
import { useFontCatalog } from "@/panels/properties/font/use-font-picker-data";
import { variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type TextAlign = NonNullable<TextNode["textAlign"]>;

const ALIGN_OPTIONS: readonly SegmentedOption<TextAlign>[] = [
  { value: "left", label: <AlignLeftIcon />, title: "Align left" },
  { value: "center", label: <AlignCenterIcon />, title: "Align center" },
  { value: "right", label: <AlignRightIcon />, title: "Align right" },
];

export const TextSection = ({ nodes }: { nodes: readonly TextNode[] }) => {
  const variables = useDocumentStore((s) => s.doc.variables);
  const apply = useApplyProps(nodes);
  const catalogReady = useFontCatalog().length > 0;
  const [editingVariable, setEditingVariable] = useState(false);
  const [node] = nodes;
  const single = nodes.length === 1 ? node : undefined;
  const contentVariable = single ? variableOf(single.content) : undefined;
  const textAlign = commonValue(nodes.map((n) => n.textAlign ?? "left"));

  return (
    <PropertySection title="Text">
      {single ? (
        contentVariable && !editingVariable ? (
          <div className="flex min-h-7 items-center">
            <VariableChip name={contentVariable} onClick={() => setEditingVariable(true)} />
          </div>
        ) : (
          <TextCommitArea
            value={contentVariable ? resolveString(single.content, variables) : single.content}
            label="Text content"
            onCommit={(content) => {
              setEditingVariable(false);
              apply({ content }, "Change text");
            }}
          />
        )
      ) : null}
      <FontFamilyField nodes={nodes} />
      <PropertyRow>
        <PropNumber
          nodes={nodes}
          propKey="fontSize"
          fallback={14}
          label="Aa"
          labelTitle="Font size"
          min={1}
          history="Change font size"
        />
        <div />
      </PropertyRow>
      <FontStyleControls nodes={nodes} catalogReady={catalogReady} />
      <PropertyRow>
        <PropNumber
          nodes={nodes}
          propKey="lineHeight"
          label="LH"
          labelTitle="Line height (multiple of font size, 0 = auto)"
          min={0}
          step={0.1}
          history="Change line height"
        />
        <PropNumber
          nodes={nodes}
          propKey="letterSpacing"
          label="LS"
          labelTitle="Letter spacing"
          step={0.1}
          history="Change letter spacing"
        />
      </PropertyRow>
      <SegmentedControl
        aria-label="Text alignment"
        value={textAlign.kind === "same" ? textAlign.value : undefined}
        options={ALIGN_OPTIONS}
        onChange={(next) => apply({ textAlign: next }, "Change text alignment")}
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
