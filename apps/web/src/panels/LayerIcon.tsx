import {
  CircleIcon,
  ComponentIcon,
  FileIcon,
  FrameIcon,
  GroupIcon,
  ImageIcon,
  PenToolIcon,
  ShapesIcon,
  SquareIcon,
  TypeIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { PegoNode, PegoNodeType } from "@pego/doc";
import { cn } from "@pego/ui/lib/utils";

const ICONS: Record<PegoNodeType, LucideIcon> = {
  frame: FrameIcon,
  group: GroupIcon,
  page: FileIcon,
  rectangle: SquareIcon,
  ellipse: CircleIcon,
  path: PenToolIcon,
  text: TypeIcon,
  icon: ShapesIcon,
  ref: ComponentIcon,
  image: ImageIcon,
  connector: WorkflowIcon,
};

/** The icon of a node type alone (no node at hand, e.g. a chip in the log). */
export const LayerTypeIcon = ({ type, className }: { type: PegoNodeType; className?: string }) => {
  const Icon = type === "ref" ? ComponentIcon : (ICONS[type] ?? ImageIcon);
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
};

/** Icon for a node: reusable nodes and instances get the violet component icon. */
export const LayerIcon = ({ node, className }: { node: PegoNode; className?: string }) => {
  const isComponent = node.reusable === true || node.type === "ref";
  const Icon = isComponent ? ComponentIcon : (ICONS[node.type] ?? ImageIcon);
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 shrink-0",
        isComponent ? "text-violet" : "text-subtle-foreground",
        className,
      )}
    />
  );
};
