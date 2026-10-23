import type { ReactNode } from "react";
import {
  ComponentIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  PaletteIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import type { MentionKind } from "@pego/agent";
import type { PegoNodeType } from "@pego/doc";
import { Tooltip } from "@pego/ui/components/tooltip";
import { cn } from "@pego/ui/lib/utils";
import { LayerTypeIcon } from "@/panels/LayerIcon";

const ICONS = {
  layer: LayersIcon,
  component: ComponentIcon,
  skill: SparklesIcon,
  style: PaletteIcon,
  attachment: ImageIcon,
  browser: GlobeIcon,
} satisfies Record<MentionKind, LucideIcon>;

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  layer: "Layer",
  component: "Component",
  skill: "Skill",
  style: "Style",
  attachment: "Image",
  browser: "Browser element",
};

/** A chip's icon: the layer's own type (frame, text, ...) when it names one, else the kind's. */
const MentionIcon = ({ kind, nodeType }: { kind: MentionKind; nodeType?: PegoNodeType }) => {
  if (kind === "layer" && nodeType) return <LayerTypeIcon type={nodeType} className="size-3" />;
  const Icon = ICONS[kind];
  return <Icon aria-hidden className="size-3 shrink-0" />;
};

type MentionPillProps = {
  kind: MentionKind;
  label: string;
  /** Type of the one layer or component the chip names; several layers show the stack icon. */
  nodeType?: PegoNodeType;
  /** The target is gone: shown muted and struck through, and not sent to the agent. */
  broken?: boolean;
  /** Hover text; a node (e.g. the list of layers) is shown in a tooltip. */
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/** A mention as a small inline pill: an icon and the target's name. */
export const MentionPill = ({
  kind,
  label,
  nodeType,
  broken,
  title,
  className,
  children,
}: MentionPillProps) => {
  const hover = title ?? `${MENTION_KIND_LABEL[kind]}: ${label}`;
  const pill = (
    <span
      title={typeof hover === "string" ? hover : undefined}
      className={cn(
        "mx-px inline-flex max-w-[180px] items-center gap-1 rounded-md border border-border bg-accent px-1 align-baseline text-[11px] leading-[16px] text-foreground",
        kind === "skill" || kind === "style" || kind === "component" ? "text-violet" : null,
        broken && "bg-muted text-muted-foreground line-through",
        className,
      )}
    >
      <MentionIcon kind={kind} nodeType={nodeType} />
      <span className="max-w-[120px] min-w-0 truncate">{label}</span>
      {children}
    </span>
  );
  if (typeof hover === "string") return pill;
  return (
    <Tooltip content={hover} side="top" className="whitespace-normal">
      {pill}
    </Tooltip>
  );
};
