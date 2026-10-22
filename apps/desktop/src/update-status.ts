/**
 * Auto-update status model. Mirrors `UpdateStatus` in apps/web/src/desktop/desktop-api.ts (the
 * renderer contract); the two packages do not share code, so keep them in sync.
 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "not-available"; checkedAt: number }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string; releaseNotes?: string }
  | { state: "error"; message: string };

export const IDLE_STATUS: UpdateStatus = { state: "idle" };

const MAX_VERSION = 64;
const MAX_NOTES = 4000;
const MAX_MESSAGE = 300;

/** Loose shape of the electron-updater payloads we read (UpdateInfo / ProgressInfo / Error). */
export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; info: { version: string; releaseNotes?: unknown } }
  | { type: "not-available"; now: number }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; info: { version: string; releaseNotes?: unknown } }
  | { type: "error"; error: unknown };

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** GitHub feeds hand back HTML; the renderer only ever gets bounded plain text. */
export const toPlainText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  )
    .trim()
    .slice(0, MAX_NOTES);

/** electron-updater releaseNotes: string | { version, note }[] | null. */
export const normalizeReleaseNotes = (raw: unknown): string | undefined => {
  const text =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((item) =>
              item &&
              typeof item === "object" &&
              typeof (item as { note?: unknown }).note === "string"
                ? (item as { note: string }).note
                : "",
            )
            .filter(Boolean)
            .join("\n\n")
        : "";
  const plain = toPlainText(text);
  return plain === "" ? undefined : plain;
};

const clampPercent = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;

const versionOf = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, MAX_VERSION) : "";

const messageOf = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  return (firstLine || "Update check failed").slice(0, MAX_MESSAGE);
};

const withNotes = <T extends { version: string }>(
  base: T,
  raw: unknown,
): T & { releaseNotes?: string } => {
  const releaseNotes = normalizeReleaseNotes(raw);
  return releaseNotes === undefined ? base : { ...base, releaseNotes };
};

/** Pure reducer: previous status + updater event -> next status. */
export const reduceUpdaterEvent = (prev: UpdateStatus, event: UpdaterEvent): UpdateStatus => {
  switch (event.type) {
    case "checking":
      // Never regress an already downloaded update to "checking".
      return prev.state === "ready" || prev.state === "downloading" ? prev : { state: "checking" };
    case "available":
      return withNotes(
        { state: "available" as const, version: versionOf(event.info.version) },
        event.info.releaseNotes,
      );
    case "not-available":
      return { state: "not-available", checkedAt: event.now };
    case "progress": {
      const version =
        prev.state === "available" || prev.state === "downloading" ? prev.version : "";
      return { state: "downloading", version, percent: clampPercent(event.percent) };
    }
    case "downloaded":
      return withNotes(
        { state: "ready" as const, version: versionOf(event.info.version) },
        event.info.releaseNotes,
      );
    case "error":
      // Keep a ready update installable even if a later check fails.
      return prev.state === "ready" ? prev : { state: "error", message: messageOf(event.error) };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

const isOptionalNotes = (value: unknown): boolean =>
  value === undefined || isBoundedString(value, MAX_NOTES);

/** Strict runtime check for a status crossing the IPC boundary (used in main and preload). */
export const isUpdateStatus = (value: unknown): value is UpdateStatus => {
  if (!isRecord(value)) return false;
  switch (value.state) {
    case "idle":
    case "checking":
      return true;
    case "not-available":
      return typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt);
    case "available":
    case "ready":
      return isBoundedString(value.version, MAX_VERSION) && isOptionalNotes(value.releaseNotes);
    case "downloading":
      return (
        isBoundedString(value.version, MAX_VERSION) &&
        typeof value.percent === "number" &&
        value.percent >= 0 &&
        value.percent <= 100
      );
    case "error":
      return isBoundedString(value.message, MAX_MESSAGE);
    default:
      return false;
  }
};

/** IPC channel allowlist shared by main and preload. */
export const UPDATE_CHANNELS = {
  check: "pego:update:check",
  install: "pego:update:install",
  getStatus: "pego:update:get-status",
  status: "pego:update:status",
} as const;

/** Only the app's own origin may drive updates (never a navigated-to foreign page). */
export const isTrustedSender = (senderUrl: string | undefined, appOrigin: string): boolean => {
  if (!senderUrl) return false;
  try {
    const url = new URL(senderUrl);
    return `${url.protocol}//${url.host}` === appOrigin;
  } catch {
    return false;
  }
};

/** App version passed to the preload through `additionalArguments`. */
export const VERSION_ARG = "--pego-version=";
export const parseVersionArg = (argv: readonly string[]): string => {
  const raw = argv.find((arg) => arg.startsWith(VERSION_ARG))?.slice(VERSION_ARG.length) ?? "";
  return /^[0-9A-Za-z.+-]{1,64}$/.test(raw) ? raw : "0.0.0";
};
