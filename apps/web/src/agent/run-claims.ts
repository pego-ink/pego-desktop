import { isContainer, opTouchedIds, type Op, type PegoDocument, type PegoNode } from "@pego/doc";

/**
 * Soft claims between parallel runs: nodes a run created or edited belong to it until it ends. A
 * tool call from another run that would modify such a node (or anything inside it) is refused so
 * that agent picks another target. Reads and user edits are never checked.
 */

export type ClaimConflict = { nodeId: string; runId: string };

/** Child id → parent id for every node of the document (roots map to null). */
export const parentMap = (doc: PegoDocument): Map<string, string | null> => {
  const parents = new Map<string, string | null>();
  const walk = (nodes: readonly PegoNode[], parentId: string | null) => {
    for (const node of nodes) {
      parents.set(node.id, parentId);
      if (isContainer(node)) walk(node.children, node.id);
    }
  };
  walk(doc.children, null);
  return parents;
};

/**
 * Ids an op takes ownership of: everything it modifies except the containers it only adds to or
 * moves out of / into. Claiming those "weak" parents would let one run lock a whole page frame
 * just by adding a child to it. Pages are never claimed either: renaming or adding a page must
 * not lock every layer on it for the other runs.
 */
export const claimTargets = (op: Op, doc: PegoDocument, parents = parentMap(doc)): string[] => {
  const weak = new Set<string>(doc.children.map((page) => page.id));
  if ((op.op === "insert" || op.op === "move") && op.parentId) weak.add(op.parentId);
  if (op.op === "move") {
    const oldParent = parents.get(op.id);
    if (oldParent) weak.add(oldParent);
  }
  return opTouchedIds(op, doc).filter((id) => !weak.has(id));
};

export const createClaims = () => {
  /** nodeId → runId that claimed it. */
  const owners = new Map<string, string>();

  /**
   * First node `ops` would touch that another active run claimed (the node itself or one of its
   * ancestors), or null. `doc` is the document before the ops.
   */
  const conflict = (
    doc: PegoDocument,
    ops: readonly Op[],
    runId: string,
    isActive: (runId: string) => boolean,
  ): ClaimConflict | null => {
    if (owners.size === 0) return null;
    const parents = parentMap(doc);
    for (const op of ops) {
      for (const touched of opTouchedIds(op, doc)) {
        let id: string | null | undefined = touched;
        while (id) {
          const owner = owners.get(id);
          if (owner && owner !== runId && isActive(owner)) return { nodeId: id, runId: owner };
          id = parents.get(id);
        }
      }
    }
    return null;
  };

  /** Claim what `ops` modify for `runId` (call after they applied; `doc` is the doc before). */
  const claim = (doc: PegoDocument, ops: readonly Op[], runId: string) => {
    // The parent map only matters for moves (their old parent); skip the walk otherwise.
    const parents = ops.some((op) => op.op === "move") ? parentMap(doc) : new Map();
    for (const op of ops) for (const id of claimTargets(op, doc, parents)) owners.set(id, runId);
  };

  const release = (runId: string) => {
    for (const [id, owner] of owners) if (owner === runId) owners.delete(id);
  };

  return {
    conflict,
    claim,
    release,
    ownerOf: (nodeId: string): string | undefined => owners.get(nodeId),
    clear: () => owners.clear(),
  };
};

export type Claims = ReturnType<typeof createClaims>;

/** The editor's claims (one document open at a time). */
export const runClaims: Claims = createClaims();
