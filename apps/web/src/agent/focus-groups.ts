import { collectIds, type PageNode } from "@pego/doc";
import { isRunActive } from "@/panels/agent/agent-format";
import { runColor } from "./run-colors";
import { liveTitle, type SessionLive } from "./use-agent-store";

/** One running session's focus box on the canvas: its nodes, tint and session title. */
export type AgentFocusGroup = {
  /** Run id (session id when the run has none yet); stable while the run works. */
  key: string;
  ids: readonly string[];
  color: string;
  label: string;
};

export const FOCUS_LABEL_CHARS = 24;

/** Session title on one line, cut with an ellipsis so the canvas tag stays small. */
export const focusLabel = (title: string, max: number = FOCUS_LABEL_CHARS): string => {
  const line = title.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/** Focus groups of every running session that is touching nodes, in session order. */
export const focusGroupsOf = (
  liveSessions: Readonly<Record<string, SessionLive>>,
): AgentFocusGroup[] =>
  Object.values(liveSessions)
    .filter((live) => isRunActive(live.status) && live.focusIds.length > 0)
    .map((live) => ({
      key: live.runId ?? live.id,
      ids: live.focusIds,
      color: runColor(live.colorIndex),
      label: focusLabel(liveTitle(live)),
    }));

const sameGroups = (a: readonly AgentFocusGroup[], b: readonly AgentFocusGroup[]) =>
  a.length === b.length &&
  a.every((group, index) => {
    const other = b[index]!;
    return (
      group.key === other.key &&
      group.ids === other.ids &&
      group.color === other.color &&
      group.label === other.label
    );
  });

/**
 * Memoized `focusGroupsOf`: returns the previous array while nothing visible changed, so the
 * canvas can skip redraws on log entries and other run updates.
 */
export const createFocusGroupsSelector = () => {
  let last: AgentFocusGroup[] = [];
  return (state: { liveSessions: Readonly<Record<string, SessionLive>> }): AgentFocusGroup[] => {
    const next = focusGroupsOf(state.liveSessions);
    if (!sameGroups(next, last)) last = next;
    return last;
  };
};

/** Every node id on a page, cached per page object (pages are immutable). */
const pageIdCache = new WeakMap<PageNode, Set<string>>();
const idsOf = (page: PageNode): Set<string> => {
  let ids = pageIdCache.get(page);
  if (!ids) pageIdCache.set(page, (ids = collectIds(page)));
  return ids;
};

/** The ids that sit on `page` (a run may work on another page than the one shown). */
export const idsOnPage = (page: PageNode, ids: readonly string[]): readonly string[] => {
  if (ids.length === 0) return ids;
  const onPage = idsOf(page);
  return ids.every((id) => onPage.has(id)) ? ids : ids.filter((id) => onPage.has(id));
};

/** Focus groups limited to the shown page; groups with nothing on it are dropped. */
export const focusOnPage = (
  groups: readonly AgentFocusGroup[],
  page: PageNode,
): readonly AgentFocusGroup[] => {
  if (groups.length === 0) return groups;
  return groups.flatMap((group) => {
    const ids = idsOnPage(page, group.ids);
    if (ids.length === 0) return [];
    return [ids === group.ids ? group : { ...group, ids }];
  });
};
