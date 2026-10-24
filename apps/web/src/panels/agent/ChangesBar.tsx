import { GitCompareArrowsIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { findNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { Tooltip } from "@pego/ui/components/tooltip";
import { canUndoRunChanges, undoRunChanges } from "@/agent/run";
import { useAgentStore, useVisibleRun, visibleSession } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { safely } from "@/panels/agent/run-actions";

/** Shown after a run: undo everything it did, or select the nodes it touched. */
export const ChangesBar = () => {
  const runId = useVisibleRun((s) => s.runId);
  const transactionCount = useVisibleRun((s) => s.transactionCount);
  const focusCount = useVisibleRun((s) => s.focusIds.length);
  // Re-evaluate when the document or its history moves (another edit may now conflict).
  useDocumentStore((s) => s.history);
  const check = runId ? canUndoRunChanges(runId) : { ok: false };

  if (transactionCount === 0 && focusCount === 0) return null;

  const review = () => {
    const { focusIds } = visibleSession(useAgentStore.getState());
    const { doc, select } = useDocumentStore.getState();
    select(focusIds.filter((id) => findNode(doc, id)));
  };

  const undo = () => {
    if (!runId) return;
    const result = undoRunChanges(runId);
    if (!result.ok && result.message) toast.error(result.message);
  };

  const undoButton = (
    <Button size="sm" variant="ghost" disabled={!check.ok} onClick={() => void safely(undo)}>
      <Undo2Icon />
      Undo all
    </Button>
  );

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-muted p-1.5 pl-3">
      <GitCompareArrowsIcon className="size-4 shrink-0 text-violet-text" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
        {transactionCount} {transactionCount === 1 ? "change" : "changes"}
      </span>
      {!check.ok && check.message ? (
        // A disabled button gets no pointer events: the wrapper carries the reason.
        <Tooltip content={check.message} side="top">
          <span
            tabIndex={0}
            className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {undoButton}
          </span>
        </Tooltip>
      ) : (
        undoButton
      )}
      <Button size="sm" variant="secondary" disabled={focusCount === 0} onClick={review}>
        Review
      </Button>
    </div>
  );
};
