import { toast } from "sonner";
import type { Op, PegoNode } from "@pego/doc";
import { loadSecret, saveSecret } from "@/agent/api-key";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { selectionBounds } from "@/interaction/zoom-utils";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { fetchFigmaImport, parseFigmaUrl } from "./figma-api";
import { convertFigmaNodes } from "./figma-convert";

const TOKEN = "figmaToken";

export const loadFigmaToken = () => loadSecret(TOKEN);
export const forgetFigmaToken = () => saveSecret(TOKEN, null);

/** Space between what is on the page and the imported layers. */
const GAP = 80;

/** Put converted layers on the shown page, to the right of what is there, as one undo step. */
const place = (nodes: PegoNode[]): string[] => {
  const state = useDocumentStore.getState();
  const page = activePage(state);
  const bounds = contentBounds(state.doc, getLayout(state.doc), page.id);
  const dx = bounds ? Math.round(bounds.x + bounds.width + GAP) : 0;
  const dy = bounds ? Math.round(bounds.y) : 0;
  const ops: Op[] = nodes.map((node) => ({
    op: "insert",
    parentId: page.id,
    node: {
      ...node,
      x: (typeof node.x === "number" ? node.x : 0) + dx,
      y: (typeof node.y === "number" ? node.y : 0) + dy,
    } as PegoNode,
  }));
  if (!state.commit(ops, { label: "Import from Figma" })) return [];
  const ids = nodes.map((node) => node.id);
  state.select(ids);
  const { doc } = useDocumentStore.getState();
  useViewportStore.getState().zoomToFit(selectionBounds(getLayout(doc), ids, doc));
  return ids;
};

/**
 * Import a Figma frame (or the first page of a file) from its link. The token is kept on this
 * device when `remember` is set, and forgotten otherwise.
 */
export const importFromFigma = async (
  link: string,
  token: string,
  remember: boolean,
): Promise<boolean> => {
  const target = parseFigmaUrl(link);
  if (!target) {
    toast.error("Paste a Figma link, for example figma.com/design/…?node-id=…");
    return false;
  }
  try {
    const fetched = await fetchFigmaImport(target, token.trim());
    await saveSecret(TOKEN, remember ? token : null).catch(() => {});
    const { nodes, warnings, count } = convertFigmaNodes(fetched.nodes, fetched.images);
    if (nodes.length === 0) {
      toast.error("Nothing in that link could be imported.");
      return false;
    }
    if (place(nodes).length === 0) return false;
    const notes = [
      ...warnings,
      ...(fetched.missingImages > 0
        ? [`${fetched.missingImages} image(s) could not be embedded`]
        : []),
    ];
    toast.success(`Imported ${fetched.name} from Figma (${count} layers)`, {
      description: notes.slice(0, 3).join(" · ") || undefined,
    });
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The Figma import failed.");
    return false;
  }
};
