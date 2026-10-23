/**
 * Which document tab a chat session belongs to. Sessions are stored per document id; while one is
 * in memory it also knows its tab, so a run started in it (now or from its queue) edits that tab's
 * document even when another tab is shown. Sessions without a home belong to the visible tab.
 */

export type SessionHome = { workspaceId: string; docId: string };

const homes = new Map<string, SessionHome>();

export const setSessionHome = (sessionId: string, home: SessionHome): void => {
  homes.set(sessionId, home);
};

export const sessionHome = (sessionId: string): SessionHome | undefined => homes.get(sessionId);

export const forgetSessionHome = (sessionId: string): void => {
  homes.delete(sessionId);
};

/** Forget the homes of every session that lived in tab `workspaceId` (its tab was deleted). */
export const forgetSessionHomesIn = (workspaceId: string): void => {
  for (const [sessionId, home] of homes)
    if (home.workspaceId === workspaceId) homes.delete(sessionId);
};

/** Drop every home (tests). */
export const clearSessionHomes = (): void => homes.clear();
