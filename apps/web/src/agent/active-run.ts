import type { Transaction } from "@pego/doc";
import type { AgentToolHost } from "./tool-host";
import type { AgentBackend } from "./use-agent-store";

/** The single run in flight (one at a time). */
export type ActiveRun = {
  id: string;
  backend: AgentBackend;
  controller: AbortController;
  host: AgentToolHost;
};

let active: ActiveRun | null = null;
/** Newest history transaction the current/last run produced (guards "Undo all"). */
let runTail: Transaction | null = null;

export const getActiveRun = (): ActiveRun | null => active;
export const setActiveRun = (run: ActiveRun | null): void => {
  active = run;
};

export const getRunTail = (): Transaction | null => runTail;
export const setRunTail = (tx: Transaction | null): void => {
  runTail = tx;
};
