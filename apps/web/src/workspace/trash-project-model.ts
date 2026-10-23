import type { ProjectInfo } from "@pego/agent";

/** Pure decisions and texts for "Move to Trash" on a project card. */

/** The tab to close before trashing: the one showing this project's design, if open. */
export const tabToClose = (
  workspaces: readonly { id: string; kind: "local" | "project" }[],
  projectId: string,
): string | null =>
  workspaces.find((workspace) => workspace.kind === "project" && workspace.id === projectId)?.id ??
  null;

export const trashConfirmText = (project: Pick<ProjectInfo, "name" | "relativeDir">) => ({
  title: `Move “${project.name}” to the Trash?`,
  folder: `design/${project.relativeDir}`,
  hint: "You can restore it from the Trash.",
  cancel: "Cancel",
  confirm: "Move to Trash",
});

export const trashedMessage = (name: string): string => `Moved “${name}” to the Trash`;

export const trashFailedMessage = (name: string, reason: string): string =>
  `Could not move “${name}” to the Trash: ${reason}`;
