import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MentionRef } from "@pego/agent";
import { MENTION_NODE } from "./composer-doc";

/** Where a live chip comes from: the canvas selection, or the element picked in the browser. */
export type LiveSource = "selection" | "browser";

export type LiveChip = { ref: MentionRef; label: string };

/**
 * The transaction that makes the prompt end with `chips` for `source`, or null when it already
 * does. Only the chips of that source at the very end of the last paragraph are replaced, so a
 * chip the user typed text after (or picked from the @ menu) stays where it is. Not recorded in
 * the undo history: selecting on the canvas is not an edit of the prompt.
 */
export const liveChipTransaction = (
  state: EditorState,
  source: LiveSource,
  chips: readonly LiveChip[],
): Transaction | null => {
  const type = state.schema.nodes[MENTION_NODE];
  const last = state.doc.lastChild;
  if (!type || !last?.isTextblock) return null;
  // End of the last paragraph's content (just before its closing token).
  const end = state.doc.content.size - 1;
  let from = end;
  const current: string[] = [];
  for (let index = last.childCount - 1; index >= 0; index--) {
    const child = last.child(index);
    if (child.type !== type || child.attrs.live !== source) break;
    from -= child.nodeSize;
    current.unshift(String(child.attrs.ref));
  }
  const wanted = chips.map((chip) => JSON.stringify(chip.ref));
  if (current.length === wanted.length && current.every((ref, index) => ref === wanted[index])) {
    return null;
  }
  const nodes = chips.map((chip) =>
    type.create({ ref: JSON.stringify(chip.ref), label: chip.label, live: source }),
  );
  return state.tr.replaceWith(from, end, nodes).setMeta("addToHistory", false);
};
