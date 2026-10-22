import { createId, findNode, representativeColor, resolveString } from "@pego/doc";
import type { Op, PegoDocument } from "@pego/doc";
import type { TextEditTarget } from "../store/use-text-edit-store";
import { defaultTextColor } from "./default-text-color";

export type ConfirmResult = {
  ops: Op[];
  label: string;
  /** Node to select after the commit. */
  selectId?: string;
};

export const DEFAULT_FONT_SIZE = 16;

/** Ops for confirming the editor, or null when nothing should be committed. */
export const buildConfirmOps = (
  doc: PegoDocument,
  target: TextEditTarget,
  content: string,
  newId: () => string = createId,
): ConfirmResult | null => {
  if (target.mode === "edit") {
    const node = findNode(doc, target.id);
    if (!node || node.type !== "text") return null;
    if (content === resolveString(node.content, doc.variables)) return null;
    if (content.trim() === "") {
      return { ops: [{ op: "delete", id: target.id }], label: "Delete text" };
    }
    return {
      ops: [{ op: "update", id: target.id, props: { content } }],
      label: "Edit text",
    };
  }

  if (content.trim() === "") return null;
  const fill = createTextColor(doc, target.parentId);
  const id = newId();
  return {
    ops: [
      {
        op: "insert",
        parentId: target.parentId,
        node: {
          id,
          type: "text",
          name: "Text",
          x: target.x,
          y: target.y,
          content,
          fontFamily: "Inter",
          fontSize: DEFAULT_FONT_SIZE,
          fill,
        },
      },
    ],
    label: "Add text",
    selectId: id,
  };
};

/** Default color for a new text node, chosen against its parent frame's fill. */
export const createTextColor = (doc: PegoDocument, parentId: string | null): string => {
  const parent = parentId ? findNode(doc, parentId) : null;
  const parentFill = parent && "fill" in parent ? parent.fill : undefined;
  return defaultTextColor(representativeColor(parentFill, doc.variables));
};
