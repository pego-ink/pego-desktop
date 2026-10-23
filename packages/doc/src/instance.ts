import { nodeSchema, type PegoDocument, type PegoNode, type RefNode } from "./schema";
import { findNode, isContainer } from "./tree";

/** Id of a node inside an expanded instance: `<instanceId>/<sourceId>`. Nested instances chain. */
export const instanceChildId = (instanceId: string, sourceId: string): string =>
  `${instanceId}/${sourceId}`;

/** Keys that describe the instance itself and never override the component. */
const REF_OWN_KEYS = new Set(["id", "type", "ref", "descendants"]);
const PROTECTED_OVERRIDE_KEYS = new Set(["id", "type", "children"]);

const pickOverrides = (props: Record<string, unknown>, blocked: Set<string>) =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !blocked.has(key)));

/** Every id in `node`'s subtree prefixed as an instance child (content an instance put in a slot). */
const prefixIds = (instanceId: string, node: PegoNode): PegoNode => {
  const prefixed = { ...node, id: instanceChildId(instanceId, node.id) } as PegoNode;
  return isContainer(node) && isContainer(prefixed)
    ? { ...prefixed, children: node.children.map((child) => prefixIds(instanceId, child)) }
    : prefixed;
};

/** Validated slot content per `children` array: resolveInstance runs often, the parse must not. */
const slotCache = new WeakMap<object, PegoNode[]>();

/**
 * The content an instance gave a slot (`descendants[slotId].children`), valid nodes only. Null
 * when the slot is not filled: no children, or none of them valid (the default content shows).
 */
const slotContent = (override: Record<string, unknown> | undefined): PegoNode[] | null => {
  const children = override?.children;
  if (!Array.isArray(children)) return null;
  let valid = slotCache.get(children);
  if (!valid) {
    valid = children.flatMap((child) => {
      const parsed = nodeSchema.safeParse(child);
      return parsed.success && parsed.data.type !== "page" ? [parsed.data] : [];
    });
    slotCache.set(children, valid);
  }
  return valid.length > 0 ? valid : null;
};

/**
 * Expand a `ref` into a concrete subtree. The root keeps the ref's id and its own props
 * (x, y, size, name, ...) on top of the component; descendants get prefixed ids and the
 * `descendants` overrides keyed by their component id. A slot frame (`slot`) may get its children
 * from the override (`descendants[slotId].children`); other children cannot be replaced. Nested
 * refs stay refs: callers expand them when they reach them. Returns null when the target is missing or not reusable.
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
    if (!isContainer(node) || !isContainer(patched)) return patched;
    const filled = node.type === "frame" && node.slot ? slotContent(overrides[node.id]) : null;
    return {
      ...patched,
      children: filled
        ? filled.map((child) => prefixIds(ref.id, child))
        : node.children.map(cloneChild),
    };
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
