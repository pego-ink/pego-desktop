/**
 * Agent run entry points used by the agent panel. Implemented by the runtime
 * (in-browser API loop or the local Claude Code bridge, by `useAgentStore().backend`).
 */
export const startRun = async (prompt: string): Promise<void> => {
  void prompt;
  throw new Error("not implemented");
};

export const cancelRun = (): void => {
  throw new Error("not implemented");
};

/** Answer the pending decision card. */
export const answerDecision = (decisionId: string, choice: string): void => {
  void decisionId;
  void choice;
  throw new Error("not implemented");
};

/** Undo every history transaction the last run created, if they are still the newest ones. */
export const undoRunChanges = (): void => {
  throw new Error("not implemented");
};

/** True when "Undo all" can run (the run's transactions are on top of the undo stack). */
export const canUndoRunChanges = (): boolean => false;
