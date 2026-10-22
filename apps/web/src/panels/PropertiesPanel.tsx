import { useMemo } from "react";
import { findNode, type PegoNode } from "@pego/doc";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { HidePanelButton } from "@/layout/PanelToggles";
import { useDocumentStore } from "@/store/use-document-store";
import { LayerIcon } from "@/panels/LayerIcon";
import { DocumentSummary } from "@/panels/properties/DocumentSummary";
import { PositionSection } from "@/panels/properties/PositionSection";
import {
  AppearanceSection,
  EffectsSection,
  StrokeSection,
} from "@/panels/properties/StyleSections";
import { FillSection } from "@/panels/properties/FillSection";
import { ExportSection } from "@/panels/properties/ExportSection";
import { LayoutSection } from "@/panels/properties/LayoutSection";
import { IconSection, RefSection, TextSection } from "@/panels/properties/ContentSections";
import { hasEffects, hasFill, hasStroke } from "@/panels/properties/node-props";

const SingleNodeSections = ({ node }: { node: PegoNode }) => (
  <>
    {node.type === "ref" ? <RefSection node={node} /> : null}
    <PositionSection nodes={[node]} />
    <AppearanceSection node={node} />
    {node.type === "frame" ? <LayoutSection node={node} /> : null}
    {node.type === "text" ? <TextSection node={node} /> : null}
    {node.type === "icon" ? <IconSection node={node} /> : null}
    {hasFill(node) ? <FillSection node={node} /> : null}
    {hasStroke(node) ? <StrokeSection node={node} /> : null}
    {hasEffects(node) ? <EffectsSection node={node} /> : null}
    <ExportSection node={node} />
  </>
);

export const PropertiesPanel = () => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const nodes = useMemo(() => selection.flatMap((id) => findNode(doc, id) ?? []), [doc, selection]);
  const [first] = nodes;

  return (
    <>
      <PanelHeader>
        {nodes.length === 0 || !first ? (
          <span>Properties</span>
        ) : nodes.length === 1 ? (
          <span className="flex min-w-0 items-center gap-2">
            <LayerIcon node={first} />
            <span className="truncate">{first.name ?? first.type}</span>
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {first.type}
            </span>
          </span>
        ) : (
          <span>{nodes.length} selected</span>
        )}
        <HidePanelButton side="right" />
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 || !first ? (
          <DocumentSummary doc={doc} />
        ) : nodes.length === 1 ? (
          <SingleNodeSections key={first.id} node={first} />
        ) : (
          <PositionSection nodes={nodes} />
        )}
      </div>
    </>
  );
};
