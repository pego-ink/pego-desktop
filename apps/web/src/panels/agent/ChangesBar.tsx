import { GitCompareArrowsIcon, Undo2Icon } from "lucide-react";
import { findNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { canUndoRunChanges, undoRunChanges } from "@/agent/run";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { safely } from "@/panels/agent/run-actions";

/** Shown after a run: undo everything it did, or select the nodes it touched. */
export const ChangesBar = () => {
  const transactionCount = useAgentStore((s) => s.transactionCount);
  const focusCount = useAgentStore((s) => s.focusIds.length);
  // Re-evaluate when the undo stack moves (the run's transactions must still be on top).
  const pastLength = useDocumentStore((s) => s.history.past.length);
  const canUndo = pastLength >= 0 && canUndoRunChanges();

  if (transactionCount === 0 && focusCount === 0) return null;

  const review = () => {
    const { focusIds } = useAgentStore.getState();
    const { doc, select } = useDocumentStore.getState();
    select(focusIds.filter((id) => findNode(doc, id)));
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1 pl-3">
      <GitCompareArrowsIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {transactionCount} {transactionCount === 1 ? "change" : "changes"}
      </span>
      <Button
        size="xs"
        variant="ghost"
        disabled={!canUndo}
        onClick={() => void safely(undoRunChanges)}
      >
        <Undo2Icon />
        Undo all
      </Button>
      <Button size="xs" variant="secondary" disabled={focusCount === 0} onClick={review}>
        Review
      </Button>
    </div>
  );
};
