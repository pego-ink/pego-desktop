import { useEffect, useState, type RefObject } from "react";
import type { PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { useDocumentStore } from "@/store/use-document-store";
import { nodeIndex, referencedComponents } from "./components";

/** Longer side of a thumbnail in pixels (cards show it at about half for sharp HiDPI). */
const THUMBNAIL_SIZE = 240;

/**
 * What a component's thumbnail depends on: its node, the document's variables and the reusable
 * nodes it instantiates (nested instances, followed down the chain). Documents are immutable, so
 * an edit to any of these is a new object and untouched ones keep their identity.
 */
type Dependencies = readonly object[];

const dependencyCache = new WeakMap<PegoDocument, Map<string, Dependencies | null>>();
/** The last dependency list per component, so equal lists are returned as the same array. */
const stableCache = new Map<string, Dependencies>();

const dependenciesOf = (doc: PegoDocument, id: string): Dependencies | null => {
  const perDoc = dependencyCache.get(doc) ?? new Map<string, Dependencies | null>();
  dependencyCache.set(doc, perDoc);
  const known = perDoc.get(id);
  if (known !== undefined) return known;
  const node = nodeIndex(doc).get(id);
  const deps = node ? [node, doc.variables, ...referencedComponents(doc, id)] : null;
  const previous = stableCache.get(id);
  const result =
    deps && previous && previous.length === deps.length && deps.every((d, i) => d === previous[i])
      ? previous
      : deps;
  if (result) stableCache.set(id, result);
  perDoc.set(id, result);
  return result;
};

/** Thumbnails by component id, valid while their dependencies are the same objects. */
const cache = new Map<string, { deps: Dependencies; pending: Promise<string | null> }>();

/** Renders run one at a time with a pause between them, so a long list never blocks the UI. */
let queue: Promise<unknown> = Promise.resolve();

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(yieldToBrowser).then(task);
  queue = run.catch(() => undefined);
  return run;
};

const render = async (id: string): Promise<string | null> => {
  const [{ loadCanvasKit }, { renderNodeImage }] = await Promise.all([
    import("@/canvas/load-canvaskit"),
    import("@/canvas/render-image"),
  ]);
  const res = await loadCanvasKit();
  const { doc } = useDocumentStore.getState();
  try {
    const image = renderNodeImage(res, doc, getLayout(doc), id, {
      maxSize: THUMBNAIL_SIZE,
      background: null,
    });
    return `data:${image.mediaType};base64,${image.data}`;
  } catch {
    // Nothing visible to draw (empty or zero-size component).
    return null;
  }
};

const thumbnailOf = (id: string, deps: Dependencies): Promise<string | null> => {
  const cached = cache.get(id);
  if (cached && cached.deps === deps) return cached.pending;
  const pending = enqueue(() => render(id));
  cache.set(id, { deps, pending });
  return pending;
};

/** The thumbnail of component `id` once `ref` has been on screen; null until then (or empty). */
export const useComponentThumbnail = (
  id: string,
  ref: RefObject<HTMLElement | null>,
): string | null => {
  const deps = useDocumentStore((s) => dependenciesOf(s.doc, id));
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState<{ deps: Dependencies; src: string | null } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);

  useEffect(() => {
    if (!seen || !deps) return;
    let live = true;
    void thumbnailOf(id, deps).then((src) => {
      if (live) setShown({ deps, src });
    });
    return () => {
      live = false;
    };
  }, [seen, id, deps]);

  // A stale thumbnail stays up while the changed component renders.
  return shown?.src ?? null;
};
