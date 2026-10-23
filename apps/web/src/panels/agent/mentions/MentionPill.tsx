import type { ReactNode } from "react";
import { ComponentIcon, ImageIcon, LayersIcon, PaletteIcon, SparklesIcon } from "lucide-react";
import type { MentionKind } from "@pego/agent";
import { cn } from "@pego/ui/lib/utils";

const ICONS = {
  layer: LayersIcon,
  component: ComponentIcon,
  skill: SparklesIcon,
  style: PaletteIcon,
  attachment: ImageIcon,
} satisfies Record<MentionKind, typeof LayersIcon>;

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  layer: "Layer",
  component: "Component",
  skill: "Skill",
  style: "Style",
  attachment: "Image",
};

type MentionPillProps = {
  kind: MentionKind;
  label: string;
  /** The target is gone: shown muted and struck through, and not sent to the agent. */
  broken?: boolean;
  title?: string;
  className?: string;
  children?: ReactNode;
};

/** A mention as a small inline pill: the kind's icon and the target's name. */
export const MentionPill = ({
  kind,
  label,
  broken,
  title,
  className,
  children,
}: MentionPillProps) => {
  const Icon = ICONS[kind];
  return (
    <span
      title={title ?? `${MENTION_KIND_LABEL[kind]}: ${label}`}
      className={cn(
        "mx-px inline-flex max-w-[180px] items-center gap-1 rounded-md bg-accent px-1 align-baseline text-[11px] leading-[18px] text-foreground",
        kind === "skill" || kind === "style" ? "text-violet" : null,
        broken && "bg-muted text-muted-foreground line-through",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </span>
  );
};
