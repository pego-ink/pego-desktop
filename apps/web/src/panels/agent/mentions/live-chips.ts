import type { Node as ProseNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MentionRef } from "@pego/agent";
import { MENTION_NODE } from "./composer-doc";

/** Where a live chip comes from: the canvas selection, or the element picked in the browser. */
export type LiveSource = "selection" | "browser";

export type LiveChip = { ref: MentionRef; label: string };

/**
 * The transaction that makes the prompt end with `chips` for `source`, or null when it already
 * does. Only live chips at the very end of the last paragraph are touched: those of `source` are
 * replaced where they are (or added at the end), those of the other source stay. A chip the user
 * typed text after, or picked from the @ menu, never moves. Not recorded in the undo history:
 * selecting on the canvas is not an edit of the prompt.
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
  const trailing: ProseNode[] = [];
  for (let index = last.childCount - 1; index >= 0; index--) {
    const child = last.child(index);
    if (child.type !== type || !child.attrs.live) break;
    from -= child.nodeSize;
    trailing.unshift(child);
  }
  const fresh = chips.map((chip) =>
    type.create({ ref: JSON.stringify(chip.ref), label: chip.label, live: source }),
  );
  const first = trailing.findIndex((node) => node.attrs.live === source);
  const others = trailing.filter((node) => node.attrs.live !== source);
  // Everything before the first chip of `source` is from the other source.
  const at = first === -1 ? others.length : first;
  const next = [...others.slice(0, at), ...fresh, ...others.slice(at)];
  const key = (nodes: readonly ProseNode[]) =>
    nodes.map((node) => `${String(node.attrs.live)}:${String(node.attrs.ref)}`).join("|");
  if (key(next) === key(trailing)) return null;
  return state.tr.replaceWith(from, end, next).setMeta("addToHistory", false);
};
