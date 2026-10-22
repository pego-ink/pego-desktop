import {
  CircleIcon,
  ComponentIcon,
  FrameIcon,
  GroupIcon,
  ImageIcon,
  PenToolIcon,
  ShapesIcon,
  SquareIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import type { PegoNode, PegoNodeType } from "@pego/doc";
import { cn } from "@pego/ui/lib/utils";

const ICONS: Record<PegoNodeType, LucideIcon> = {
  frame: FrameIcon,
  group: GroupIcon,
  rectangle: SquareIcon,
  ellipse: CircleIcon,
  path: PenToolIcon,
  text: TypeIcon,
  icon: ShapesIcon,
  ref: ComponentIcon,
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
        isComponent ? "text-violet" : "text-muted-foreground",
        className,
      )}
    />
  );
};
