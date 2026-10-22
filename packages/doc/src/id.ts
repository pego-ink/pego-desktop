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
export const cloneWithFreshIds = (node: PegoNode): PegoNode => {
  const copy = { ...node, id: createId() } as PegoNode;
  return isContainer(node) && isContainer(copy)
    ? { ...copy, children: node.children.map(cloneWithFreshIds) }
    : copy;
};
