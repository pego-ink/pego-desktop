import { useCallback } from "react";
import type { PegoNode } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";

export type Phase = "commit" | "extend";
export type PropsInput = Record<string, unknown> | ((node: PegoNode) => Record<string, unknown>);

/**
 * Apply a prop change to every node in `nodes` as one `update` batch. "commit" opens an undo
 * step labelled `label`, "extend" folds into the previous step (continuous gestures).
 */
export const useApplyProps = (nodes: readonly PegoNode[]) =>
  useCallback(
    (props: PropsInput, label: string, phase: Phase = "commit") => {
      const ops = nodes.map((node) => ({
        op: "update" as const,
        id: node.id,
        props: typeof props === "function" ? props(node) : props,
      }));
      const { commit, extendLast } = useDocumentStore.getState();
      return phase === "commit" ? commit(ops, { label }) : extendLast(ops);
    },
    [nodes],
  );
