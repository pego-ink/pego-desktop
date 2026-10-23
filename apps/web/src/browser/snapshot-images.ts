import type { DomBox, DomSnapshot, DomSnapshotNode } from "@pego/agent";

/** Total image data one snapshot may carry (decoded bytes), screenshots and fetched images together. */
export const IMAGE_BUDGET_BYTES = 12 * 1024 * 1024;
export const FETCH_CONCURRENCY = 6;
export const FETCH_TIMEOUT_MS = 15_000;
export const SCREENSHOT_TIMEOUT_MS = 20_000;
/** Long side cap of a raster stand-in, in output pixels. */
export const RASTER_MAX_SIDE = 2048;
export const RASTER_SCALE = 2;
/** Long side cap of a normalized remote image. */
export const NORMALIZED_MAX_SIDE = 2560;

const PASS_THROUGH = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Decoded size of a data URL (base64 payload), in bytes. */
export const dataUrlBytes = (url: string): number => {
  const comma = url.indexOf(",");
  if (comma < 0) return url.length;
  const payload = url.length - comma - 1;
  return url.slice(0, comma).includes(";base64") ? Math.floor((payload * 3) / 4) : payload;
};

/** Running total against a limit; `take` refuses what would not fit. */
export const createBudget = (limit: number) => {
  let used = 0;
  return {
    take: (bytes: number): boolean => {
      if (used + bytes > limit) return false;
      used += bytes;
      return true;
    },
    used: () => used,
  };
};
export type Budget = ReturnType<typeof createBudget>;

/** MIME type of a data URL, lowercase; "" when it is not one. */
export const dataUrlMime = (url: string): string => {
  const match = /^data:([^;,]*)/i.exec(url);
  return match ? (match[1] ?? "").toLowerCase() : "";
};

/** Pego accepts png/jpeg/webp/gif as they are; everything else is redrawn through a canvas. */
export const needsNormalization = (dataUrl: string): boolean =>
  !PASS_THROUGH.has(dataUrlMime(dataUrl));

/** Scale that fits the longer side into `maxSide`; never enlarges. */
export const fitScale = (width: number, height: number, maxSide: number): number =>
  Math.min(1, maxSide / Math.max(width, height, 1));

/** Screenshot clip for a raster stand-in: 2x for crispness, long side capped at 2048 px. */
export const rasterClip = (box: DomBox) => ({
  x: box.x,
  y: box.y,
  width: box.width,
  height: box.height,
  scale: Math.min(RASTER_SCALE, RASTER_MAX_SIDE / Math.max(box.width, box.height, 1)),
});

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;
const isRemote = (url: string): boolean => /^https?:\/\//i.test(url);

/** The http(s) URLs inside a CSS `background-image` value. */
export const remoteBackgroundUrls = (css: string): string[] =>
  [...css.matchAll(URL_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").filter((url) => isRemote(url));

/** `css` with each http(s) url() replaced by `replace(url)` when that returns a string. */
export const replaceBackgroundUrls = (
  css: string,
  replace: (url: string) => string | undefined,
): string =>
  css.replace(URL_RE, (whole, a?: string, b?: string, c?: string) => {
    const url = a ?? b ?? c ?? "";
    const next = isRemote(url) ? replace(url) : undefined;
    return next === undefined ? whole : `url("${next}")`;
  });

/** Runs `fn` over `items` with at most `limit` in flight. */
export const mapLimit = async <T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

/** Rejects when `promise` takes longer than `ms`. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

type Parented = { node: DomSnapshotNode; parent: DomSnapshotNode | null };

const flatten = (root: DomSnapshotNode): Parented[] => {
  const out: Parented[] = [];
  const visit = (node: DomSnapshotNode, parent: DomSnapshotNode | null) => {
    out.push({ node, parent });
    if (node.kind === "element") for (const child of node.children) visit(child, node);
  };
  visit(root, null);
  return out;
};

export type SnapshotImageDeps = {
  /** Screenshot of a page-coordinate clip as a PNG data URL. */
  capture: (clip: ReturnType<typeof rasterClip>) => Promise<string>;
  /** Makes the browser view paint (called once, before the first capture). */
  ensureVisible: () => Promise<void>;
  /** The desktop's main-process fetch; absent in older shells. */
  fetchImage?: (url: string) => Promise<string>;
  /** Redraws a non-pass-through data URL into webp/png. */
  normalize: (dataUrl: string) => Promise<string>;
  budget?: Budget;
  warn?: (message: string) => void;
};

/**
 * Fills the snapshot's raster stand-ins with screenshots and inlines remote images (`<img>` and
 * `url()` backgrounds) as Pego-accepted data URLs, within one shared byte budget. Mutates and
 * returns `snapshot`. Rasters that fail or do not fit are dropped (never left with an empty src);
 * remote images that fail or do not fit keep their https URL.
 */
export const inlineSnapshotImages = async (
  snapshot: DomSnapshot,
  deps: SnapshotImageDeps,
): Promise<DomSnapshot> => {
  const budget = deps.budget ?? createBudget(IMAGE_BUDGET_BYTES);
  const warn = deps.warn ?? ((message: string) => console.warn(`[pego browser] ${message}`));
  const nodes = flatten(snapshot.root);

  // 1. Rasters first: they are the only way to show those elements at all.
  const rasters = nodes.filter(({ node }) => node.kind === "image" && node.raster === true);
  const dropped = new Set<DomSnapshotNode>();
  if (rasters.length > 0) {
    await deps.ensureVisible().catch(() => undefined);
    for (const { node } of rasters) {
      if (node.kind !== "image") continue;
      if (node.box.width < 1 || node.box.height < 1) {
        dropped.add(node);
        continue;
      }
      try {
        const url = await withTimeout(
          deps.capture(rasterClip(node.box)),
          SCREENSHOT_TIMEOUT_MS,
          "screenshot",
        );
        if (!budget.take(dataUrlBytes(url))) {
          warn(`image budget reached: dropped a <${node.tag}> screenshot`);
          dropped.add(node);
        } else node.src = url;
      } catch (error) {
        warn(`screenshot of <${node.tag}> failed: ${(error as Error).message}`);
        dropped.add(node);
      }
    }
  }

  // 2. Remote images, one fetch per distinct URL.
  const fetchImage = deps.fetchImage;
  if (fetchImage) {
    const urls = new Set<string>();
    for (const { node } of nodes) {
      if (node.kind === "image" && !node.raster && isRemote(node.src)) urls.add(node.src);
      const bg = node.kind === "svg" ? undefined : node.style.backgroundImage;
      if (bg) for (const url of remoteBackgroundUrls(bg)) urls.add(url);
    }
    const resolved = new Map<string, string>();
    await mapLimit([...urls], FETCH_CONCURRENCY, async (url) => {
      try {
        const fetched = await withTimeout(fetchImage(url), FETCH_TIMEOUT_MS, "image fetch");
        const dataUrl = needsNormalization(fetched)
          ? await withTimeout(deps.normalize(fetched), FETCH_TIMEOUT_MS, "image conversion")
          : fetched;
        if (!budget.take(dataUrlBytes(dataUrl))) {
          warn(`image budget reached: left ${url} as a link`);
          return;
        }
        resolved.set(url, dataUrl);
      } catch (error) {
        warn(`could not inline ${url}: ${(error as Error).message}`);
      }
    });
    for (const { node } of nodes) {
      if (node.kind === "image" && !node.raster) {
        const next = resolved.get(node.src);
        if (next) node.src = next;
      }
      if (node.kind !== "svg" && node.style.backgroundImage) {
        node.style.backgroundImage = replaceBackgroundUrls(node.style.backgroundImage, (url) =>
          resolved.get(url),
        );
      }
    }
  }

  // 3. Remove rasters that could not be filled (never the root).
  for (const { node, parent } of nodes) {
    if (!dropped.has(node) || parent?.kind !== "element") continue;
    parent.children = parent.children.filter((child) => child !== node);
  }
  return snapshot;
};
