// Image tool: activating it opens a file picker; the next click or drag on the canvas places
// the chosen image (click = natural size capped at 800 px, drag = the dragged box).
import { roundPx, snapEnabled } from "@/interaction/snap";
import { getLayout } from "@/canvas/layout";
import { drawUpdateOps, drawBox } from "@/interaction/create-node";
import {
  buildImageNode,
  pickImageFile,
  placementAt,
  placementSize,
  readImageFile,
  type ImageAsset,
} from "@/interaction/image-file";
import { registerToolHandler, type ToolPointer } from "@/interaction/tool-handlers";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";

const DRAG_THRESHOLD = 3;

let pending: ImageAsset | null = null;
/** Bumped on every activation/deactivation so a late picker result cannot revive the tool. */
let epoch = 0;

const openPicker = async () => {
  const mine = ++epoch;
  pending = null;
  const file = await pickImageFile();
  if (mine !== epoch) return;
  const asset = file ? await readImageFile(file) : null;
  if (mine !== epoch) return;
  if (!asset) {
    useToolStore.getState().setTool("select");
    return;
  }
  pending = asset;
};

useToolStore.subscribe((state, previous) => {
  if (state.tool === "image" && previous.tool !== "image") void openPicker();
});

registerToolHandler("image", {
  cursor: "crosshair",
  deactivate: () => {
    epoch++;
    pending = null;
  },
  begin: (p: ToolPointer) => {
    const asset = pending;
    if (!asset) return null;
    const store = useDocumentStore.getState();
    const layout = getLayout(store.doc);
    const placement = placementAt(store.doc, layout, p.doc);
    const start = p.doc;
    const natural = placementSize(asset);
    const node = buildImageNode(store.doc, asset, placement, {
      x: roundPx(start.x, snapEnabled()),
      y: roundPx(start.y, snapEnabled()),
      ...natural,
    });
    if (
      !store.commit([{ op: "insert", parentId: placement.parentId, node }], {
        label: "Place image",
      })
    ) {
      return null;
    }
    let dragged = false;

    return {
      move: (q) => {
        if (
          !dragged &&
          Math.hypot(q.screen.x - p.screen.x, q.screen.y - p.screen.y) < DRAG_THRESHOLD
        ) {
          return;
        }
        dragged = true;
        const ratio = asset.width / asset.height;
        let end = q.doc;
        if (q.shiftKey) {
          // Shift locks the image's aspect ratio.
          const dx = q.doc.x - start.x;
          const dy = q.doc.y - start.y;
          const width = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
          end = {
            x: start.x + (dx < 0 ? -width : width),
            y: start.y + (dy < 0 ? -width / ratio : width / ratio),
          };
        }
        const box = drawBox(start, end, { alt: q.altKey });
        useDocumentStore.getState().extendLast(drawUpdateOps(node.id, placement, box));
      },
      up: () => {
        const doc = useDocumentStore.getState();
        doc.select([node.id]);
        pending = null;
        useToolStore.getState().setTool("select");
      },
      cancel: () => {
        useDocumentStore.getState().undo();
      },
    };
  },
});
