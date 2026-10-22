import { adjacentTab, tabIdForDigit, type TabShortcut } from "./tab-bar-model";
import { requestCloseTab } from "./use-close-confirm";
import {
  activateWorkspace,
  newDocumentTab,
  showDashboard,
  useWorkspaceStore,
} from "./use-workspace-store";

export const HOME_TAB_ID = "home";

/** The Home tab followed by every document tab, in bar order. */
const tabIds = (): string[] => [
  HOME_TAB_ID,
  ...useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id),
];

const activeTabId = (): string => {
  const { view, liveId } = useWorkspaceStore.getState();
  return view === "dashboard" || liveId === null ? HOME_TAB_ID : liveId;
};

export const activateTab = (id: string): void => {
  if (id === HOME_TAB_ID) showDashboard();
  else activateWorkspace(id);
};

/** Run a keyboard/menu tab command. */
export const runTabAction = (action: TabShortcut | { kind: "close" }): void => {
  const { view, liveId, workspaces } = useWorkspaceStore.getState();
  if (action.kind === "new") {
    newDocumentTab();
  } else if (action.kind === "close") {
    if (view === "editor" && liveId) requestCloseTab(liveId);
  } else if (action.kind === "step") {
    const next = adjacentTab(tabIds(), activeTabId(), action.step);
    if (next) activateTab(next);
  } else {
    const id = tabIdForDigit(
      action.digit,
      workspaces.map((workspace) => workspace.id),
    );
    if (id) activateTab(id);
  }
};
