import type { AgentLogEntry } from "@/agent/use-agent-store";

export type ToolGroup = { type: "tools"; id: string; calls: AgentLogEntry[] };
export type LogItem = { type: "entry"; entry: AgentLogEntry } | ToolGroup;
export type ToolRun = { key: string; name: string; detail: string; failed: boolean; count: number };

export const toolName = (entry: AgentLogEntry) => entry.tool?.name ?? entry.text;

/** Extra text worth showing next to the name; empty when it only repeats the name. */
export const toolDetail = (entry: AgentLogEntry) => {
  const text = entry.text.trim();
  return text === toolName(entry) ? "" : text;
};

/** Merges consecutive `tool` entries into one group, keyed by the first entry id. */
export const groupLog = (log: readonly AgentLogEntry[]): LogItem[] => {
  const items: LogItem[] = [];
  for (const entry of log) {
    if (entry.kind !== "tool") {
      items.push({ type: "entry", entry });
      continue;
    }
    const last = items.at(-1);
    if (last?.type === "tools") last.calls.push(entry);
    else items.push({ type: "tools", id: entry.id, calls: [entry] });
  }
  return items;
};

export const countFailed = (calls: readonly AgentLogEntry[]) =>
  calls.filter((call) => call.tool?.isError).length;

/** Distinct tool names in first-call order. */
export const distinctNames = (calls: readonly AgentLogEntry[]) => [...new Set(calls.map(toolName))];

/** "a, b, c +2": first `max` distinct names, then the remainder count. */
export const summarizeNames = (calls: readonly AgentLogEntry[], max = 3) => {
  const names = distinctNames(calls);
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
};

/** Consecutive identical calls (same name, detail and outcome) collapse into one run with a count. */
export const collapseRuns = (calls: readonly AgentLogEntry[]): ToolRun[] => {
  const runs: ToolRun[] = [];
  for (const call of calls) {
    const name = toolName(call);
    const detail = toolDetail(call);
    const failed = call.tool?.isError === true;
    const last = runs.at(-1);
    if (last && last.name === name && last.detail === detail && last.failed === failed) {
      last.count += 1;
    } else {
      runs.push({ key: call.id, name, detail, failed, count: 1 });
    }
  }
  return runs;
};
