import { useEffect, useState, type RefObject } from "react";
import { findNode, type PegoNode } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { useDocumentStore } from "@/store/use-document-store";

/** Longer side of a thumbnail in pixels (cards show it at about half for sharp HiDPI). */
const THUMBNAIL_SIZE = 240;

/**
 * Component thumbnails for the Assets panel, rendered on demand (only cards on screen) and cached
 * per node object: documents are immutable, so a component that changed is a new object and gets
 * a new thumbnail, while untouched ones keep theirs.
 */
const cache = new WeakMap<PegoNode, Promise<string | null>>();

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

const thumbnailOf = (node: PegoNode): Promise<string | null> => {
  const cached = cache.get(node);
  if (cached) return cached;
  const pending = render(node.id);
  cache.set(node, pending);
  return pending;
};

/** The thumbnail of component `id` once `ref` has been on screen; null until then (or empty). */
export const useComponentThumbnail = (
  id: string,
  ref: RefObject<HTMLElement | null>,
): string | null => {
  const node = useDocumentStore((s) => findNode(s.doc, id));
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState<{ node: PegoNode; src: string | null } | null>(null);

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
    if (!seen || !node) return;
    let live = true;
    void thumbnailOf(node).then((src) => {
      if (live) setShown({ node, src });
    });
    return () => {
      live = false;
    };
  }, [seen, node]);

  // A stale thumbnail stays up while the changed component renders.
  return shown?.src ?? null;
};
