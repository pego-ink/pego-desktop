import type { PegoNode } from "./schema";
import { isContainer } from "./tree";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 8;

/** Short random node id (8 chars base36, ~41 bits). Callers still check uniqueness via ops. */
export const createId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
};

/** Deep copy of a subtree where every node gets a new id. */
export const cloneWithFreshIds = (node: PegoNode): PegoNode =>
  cloneAllWithFreshIds([node])[0] as PegoNode;

/**
 * Deep copies of several subtrees with new ids. A copied connector whose end was copied too
 * points at the copy (a screen pair duplicated with its arrow stays connected); other ends keep
 * pointing at the original layer.
 */
export const cloneAllWithFreshIds = (nodes: readonly PegoNode[]): PegoNode[] => {
  const fresh = new Map<string, string>();
  const clone = (node: PegoNode): PegoNode => {
    const id = createId();
    fresh.set(node.id, id);
    const copy = { ...node, id } as PegoNode;
    return isContainer(node) && isContainer(copy)
      ? { ...copy, children: node.children.map(clone) }
      : copy;
  };
  const end = <T extends { id: string }>(e: T): T => ({ ...e, id: fresh.get(e.id) ?? e.id });
  const reattach = (node: PegoNode): PegoNode => {
    if (node.type === "connector") return { ...node, from: end(node.from), to: end(node.to) };
    return isContainer(node) ? { ...node, children: node.children.map(reattach) } : node;
  };
  return nodes.map(clone).map(reattach);
};
