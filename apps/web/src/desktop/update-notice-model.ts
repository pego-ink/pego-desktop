import type { UpdateStatus } from "./desktop-api";

/** What the floating update card shows; `null` hides it. */
export type NoticeView =
  { kind: "downloading"; version: string; percent: number } | { kind: "ready"; version: string };

/**
 * Maps the updater status to the card. "available", "checking", errors and "not available" stay
 * quiet. A "ready" update the user dismissed (Later) stays hidden until a different version lands.
 */
export const noticeView = (
  status: UpdateStatus,
  dismissedVersion: string | null,
): NoticeView | null => {
  if (status.state === "downloading") {
    return { kind: "downloading", version: status.version, percent: clampPercent(status.percent) };
  }
  if (status.state === "ready" && status.version !== dismissedVersion) {
    return { kind: "ready", version: status.version };
  }
  return null;
};

export const clampPercent = (percent: number): number =>
  Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;

export const noticeTitle = (view: NoticeView): string => {
  const name = view.version ? `Pego ${view.version}` : "The update";
  return view.kind === "ready" ? `${name} is ready` : `Downloading ${name}`;
};

export const sameNoticeView = (a: NoticeView | null, b: NoticeView): boolean => {
  if (!a || a.kind !== b.kind || a.version !== b.version) return false;
  return a.kind === "downloading" && b.kind === "downloading" ? a.percent === b.percent : true;
};
