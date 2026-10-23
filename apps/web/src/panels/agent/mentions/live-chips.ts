import type { Node as ProseNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MentionRef } from "@pego/agent";
import { MENTION_NODE } from "./composer-doc";

/** Where a live chip comes from: the canvas selection, or the element picked in the browser. */
export type LiveSource = "selection" | "browser";

export type LiveChip = { ref: MentionRef; label: string };

/**
 * The transaction that puts `chips` for `source` at `at` (the caret; the end of the prompt when
 * omitted), or null when they are already there. Only live chips right before that point are
 * touched: those of `source` are replaced where they are (or the chips are added), those of the
 * other source stay. So clicking another layer swaps the chip, while text typed after a chip keeps
 * it and the next click adds a new one at the caret. A chip picked from the @ menu never moves.
 * Not recorded in the undo history: selecting on the canvas is not an edit of the prompt.
 */
export const liveChipTransaction = (
  state: EditorState,
  source: LiveSource,
  chips: readonly LiveChip[],
  at?: number,
): Transaction | null => {
  const type = state.schema.nodes[MENTION_NODE];
  // Default: end of the last paragraph's content (just before its closing token).
  const anchor = at ?? state.doc.content.size - 1;
  const $anchor = state.doc.resolve(Math.min(Math.max(anchor, 0), state.doc.content.size));
  const block = $anchor.parent;
  if (!type || !block.isTextblock) return null;
  let from = $anchor.pos;
  const trailing: ProseNode[] = [];
  // Inside a word there is nothing right before the caret to replace.
  if ($anchor.textOffset === 0) {
    for (let index = $anchor.index() - 1; index >= 0; index--) {
      const child = block.child(index);
      if (child.type !== type || !child.attrs.live) break;
      from -= child.nodeSize;
      trailing.unshift(child);
    }
  }
  const fresh = chips.map((chip) =>
    type.create({ ref: JSON.stringify(chip.ref), label: chip.label, live: source }),
  );
  const first = trailing.findIndex((node) => node.attrs.live === source);
  const others = trailing.filter((node) => node.attrs.live !== source);
  // Everything before the first chip of `source` is from the other source.
  const slot = first === -1 ? others.length : first;
  const next = [...others.slice(0, slot), ...fresh, ...others.slice(slot)];
  const key = (nodes: readonly ProseNode[]) =>
    nodes.map((node) => `${String(node.attrs.live)}:${String(node.attrs.ref)}`).join("|");
  if (key(next) === key(trailing)) return null;
  return state.tr.replaceWith(from, $anchor.pos, next).setMeta("addToHistory", false);
};
