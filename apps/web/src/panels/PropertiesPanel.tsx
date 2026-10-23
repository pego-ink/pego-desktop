import { useMemo } from "react";
import { findNode, type PegoNode, type TextNode } from "@pego/doc";
import { SparklesIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { HideRightPanelButton } from "@/layout/PanelToggles";
import { useDocumentStore } from "@/store/use-document-store";
import { copySelectionForAgent } from "@/interaction/agent-reference";
import { LayerIcon } from "@/panels/LayerIcon";
import { DocumentSummary } from "@/panels/properties/DocumentSummary";
import { FramePresetSection } from "@/panels/frame-presets/FramePresetSection";
import { PositionSection } from "@/panels/properties/PositionSection";
import {
  AppearanceSection,
  EffectsSection,
  StrokeSection,
} from "@/panels/properties/StyleSections";
import { FillSection } from "@/panels/properties/FillSection";
import { ExportSection } from "@/panels/properties/ExportSection";
import { AnimationSection } from "@/panels/properties/AnimationSection";
import { LayoutSection } from "@/panels/properties/LayoutSection";
import { ImageSection } from "@/panels/properties/ImageSection";
import { IconSection, RefSection, TextSection } from "@/panels/properties/ContentSections";
import { PathSection } from "@/panels/properties/PathSection";
import { InstanceSlotsSection, SlotSection } from "@/panels/properties/SlotSections";
import { hasEffects, hasFill, hasStroke } from "@/panels/properties/node-props";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const COPY_FOR_AI_SHORTCUT = isMac ? "⇧⌘C" : "Ctrl+Shift+C";

const SingleNodeSections = ({ node }: { node: PegoNode }) => (
  <>
    {node.type === "ref" ? <RefSection node={node} /> : null}
    {node.type === "ref" ? <InstanceSlotsSection node={node} /> : null}
    <PositionSection nodes={[node]} />
    {node.type === "frame" ? <FramePresetSection node={node} /> : null}
    <AppearanceSection node={node} />
    {node.type === "frame" ? <LayoutSection node={node} /> : null}
    {node.type === "frame" ? <SlotSection node={node} /> : null}
    {node.type === "text" ? <TextSection nodes={[node]} /> : null}
    {node.type === "icon" ? <IconSection node={node} /> : null}
    {node.type === "image" ? <ImageSection node={node} /> : null}
    {hasFill(node) ? <FillSection node={node} /> : null}
    {hasStroke(node) ? <StrokeSection node={node} /> : null}
    {node.type === "path" ? <PathSection node={node} /> : null}
    {hasEffects(node) ? <EffectsSection node={node} /> : null}
    <AnimationSection node={node} />
    <ExportSection node={node} />
  </>
);

export const PropertiesPanel = () => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const nodes = useMemo(() => selection.flatMap((id) => findNode(doc, id) ?? []), [doc, selection]);
  const textNodes = useMemo(() => nodes.filter((n): n is TextNode => n.type === "text"), [nodes]);
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
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {nodes.length > 0 ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy for AI"
              title={`Copy project, file and node ids for the AI agent (${COPY_FOR_AI_SHORTCUT})`}
              className="text-muted-foreground"
              onClick={() => void copySelectionForAgent()}
            >
              <SparklesIcon />
            </Button>
          ) : null}
          <HideRightPanelButton />
        </span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 || !first ? (
          <DocumentSummary doc={doc} />
        ) : nodes.length === 1 ? (
          <SingleNodeSections key={first.id} node={first} />
        ) : (
          <>
            <PositionSection nodes={nodes} />
            {textNodes.length === nodes.length ? <TextSection nodes={textNodes} /> : null}
          </>
        )}
      </div>
    </>
  );
};
