export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_URL_LENGTH = 4096;
export const MAX_IMAGE_REDIRECTS = 5;

/** Validates the IPC payload and returns a normalized http(s) URL, or null. */
export const parseImageUrl = (input: unknown): string | null => {
  if (typeof input !== "string" || !input || input.length > MAX_IMAGE_URL_LENGTH) return null;
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
};

/** Returns the lowercase media type (without parameters) when it is an `image/*` type. */
export const parseImageContentType = (header: string | null | undefined): string | null => {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return type && /^image\/[a-z0-9][a-z0-9.+-]*$/.test(type) ? type : null;
};

/** True when a declared content-length (header value) is acceptable; a missing one is checked while streaming. */
export const isDeclaredSizeOk = (
  header: string | null | undefined,
  max = MAX_IMAGE_BYTES,
): boolean => {
  if (header == null || header === "") return true;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 && n <= max;
};

/** Resolves a redirect Location against the current URL; null unless it stays http(s). */
export const resolveRedirect = (
  location: string | null | undefined,
  base: string,
): string | null => {
  if (!location) return null;
  try {
    return parseImageUrl(new URL(location, base).href);
  } catch {
    return null;
  }
};

/** Runs tasks with at most `limit` in flight; the rest wait in a queue. */
export const createQueue = (limit: number) => {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = (): void => {
    const start = waiting.shift();
    if (start) start();
    else active -= 1;
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        task().then(resolve, reject).finally(next);
      };
      if (active < limit) {
        active += 1;
        run();
      } else waiting.push(run);
    });
};
