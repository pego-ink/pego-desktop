import type { PegoNode } from "@pego/doc";
import { LayerIcon } from "@/panels/LayerIcon";

/** Most layers a chip's hover list names; the rest are counted. */
export const LISTED_LAYERS = 10;

/** The layers of a multi-layer chip, one row each, for its tooltip. */
export const MentionLayerList = ({ nodes }: { nodes: readonly PegoNode[] }) => (
  <span className="flex max-w-56 flex-col gap-1 py-0.5">
    {nodes.slice(0, LISTED_LAYERS).map((node) => (
      <span key={node.id} className="flex min-w-0 items-center gap-1.5">
        <LayerIcon node={node} className="size-3 text-background/70" />
        <span className="truncate">{node.name ?? node.type}</span>
      </span>
    ))}
    {nodes.length > LISTED_LAYERS ? (
      <span className="opacity-60">and {nodes.length - LISTED_LAYERS} more</span>
    ) : null}
  </span>
);
