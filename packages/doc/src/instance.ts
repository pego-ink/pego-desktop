import type { PegoDocument, PegoNode, RefNode } from "./schema";
import { findNode, isContainer } from "./tree";

/** Id of a node inside an expanded instance: `<instanceId>/<sourceId>`. Nested instances chain. */
export const instanceChildId = (instanceId: string, sourceId: string): string =>
  `${instanceId}/${sourceId}`;

/** Keys that describe the instance itself and never override the component. */
const REF_OWN_KEYS = new Set(["id", "type", "ref", "descendants"]);
const PROTECTED_OVERRIDE_KEYS = new Set(["id", "type", "children"]);

const pickOverrides = (props: Record<string, unknown>, blocked: Set<string>) =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !blocked.has(key)));

/**
 * Expand a `ref` into a concrete subtree. The root keeps the ref's id and its own props
 * (x, y, size, name, ...) on top of the component; descendants get prefixed ids and the
 * `descendants` overrides keyed by their component id. Nested refs stay refs: callers
 * expand them when they reach them. Returns null when the target is missing or not reusable.
 */
export const resolveInstance = (doc: PegoDocument, ref: RefNode): PegoNode | null => {
  const source = findNode(doc, ref.ref);
  if (!source?.reusable) return null;
  const overrides = ref.descendants ?? {};

  const cloneChild = (node: PegoNode): PegoNode => {
    const patched = {
      ...node,
      ...pickOverrides(overrides[node.id] ?? {}, PROTECTED_OVERRIDE_KEYS),
      id: instanceChildId(ref.id, node.id),
    } as PegoNode;
    return isContainer(node) && isContainer(patched)
      ? { ...patched, children: node.children.map(cloneChild) }
      : patched;
  };

  const root = {
    ...source,
    ...pickOverrides(ref, REF_OWN_KEYS),
    id: ref.id,
    reusable: false,
  } as PegoNode;
  return isContainer(source) && isContainer(root)
    ? { ...root, children: source.children.map(cloneChild) }
    : root;
};
