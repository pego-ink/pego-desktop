import {
  cloneAllWithFreshIds,
  collectDocIds,
  createId,
  findLocation,
  findNode,
  isContainer,
  nodeSchema,
  placedByLayout,
  resolveInstance,
  resolveNumber,
  type Layout,
  type Op,
  variablesSchema,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { svgToNode } from "@pego/agent";
import { createTextColor, DEFAULT_FONT_SIZE } from "@/text-edit/confirm-edit";
import { topmostSelected } from "./transform";

/**
 * Copy and paste of layers. Copy puts the layers on the clipboard as data (the document they came
 * from, the layers as they are, the same layers with instances detached, and the variables they
 * use); paste puts copies back, in this document or another one. SVG markup and plain text paste
 * as new layers too.
 */

/** Clipboard type of copied layers (data the canvas pastes). */
export const NODES_MIME = "application/x-pego-nodes";

type Variables = PegoDocument["variables"];

export type NodesPayload = {
  version: 1;
  docId: string;
  /** The layers as they are (instances still point at their components). */
  nodes: PegoNode[];
  /**
   * The same layers with every instance replaced by what it shows (for another document). Left
   * out when no layer holds an instance: `nodes` already is the plain version.
   */
  detached?: PegoNode[];
  /** The variables the layers use, so another document can get them too. */
  variables: Variables;
  /** Where each layer sat: its parent, so a paste in the same document lands beside it. */
  parents: (string | null)[];
};

/** Every instance in `node` replaced by a plain copy of what it shows (nested ones too). */
const detachAll = (doc: PegoDocument, node: PegoNode): PegoNode => {
  const plain = node.type === "ref" ? (resolveInstance(doc, node) ?? node) : node;
  if (!isContainer(plain)) return plain;
  return { ...plain, children: plain.children.map((child) => detachAll(doc, child)) } as PegoNode;
};

const hasInstance = (node: PegoNode): boolean =>
  node.type === "ref" || (isContainer(node) && node.children.some(hasInstance));

/** Names of the variables a value refers to (`"$accent"` anywhere inside it). */
const usedVariables = (value: unknown, into = new Set<string>()): Set<string> => {
  if (typeof value === "string" && value.startsWith("$")) into.add(value.slice(1));
  else if (Array.isArray(value)) for (const item of value) usedVariables(item, into);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) usedVariables(item, into);
  }
  return into;
};

/** What copying `ids` puts on the clipboard, or null when nothing copyable is selected. */
export const copyPayload = (doc: PegoDocument, ids: readonly string[]): NodesPayload | null => {
  const locs = topmostSelected(doc, ids).flatMap((id) => {
    const loc = findLocation(doc, id);
    return loc && loc.node.type !== "page" ? [loc] : [];
  });
  if (locs.length === 0) return null;
  const nodes = locs.map((loc) => loc.node);
  const hasRefs = nodes.some((node) => hasInstance(node));
  const detached = hasRefs ? nodes.map((node) => detachAll(doc, node)) : undefined;
  // Instances use their component's variables too: read them from the detached copies.
  const variables: Variables = {};
  for (const name of usedVariables([nodes, detached ?? []])) {
    const variable = doc.variables[name];
    if (variable) variables[name] = variable;
  }
  return {
    version: 1,
    docId: doc.id,
    nodes,
    detached,
    variables,
    parents: locs.map((loc) => loc.parentId),
  };
};

/** Largest clipboard text read as a payload, and most layers it may hold. */
export const MAX_PAYLOAD_CHARS = 20_000_000;
export const MAX_PAYLOAD_NODES = 5_000;

const countNodes = (nodes: readonly PegoNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + (isContainer(node) ? countNodes(node.children) : 0), 0);

/** Every item through `nodeSchema` (clipboard data comes from anywhere); null if one fails. */
const parseNodes = (value: unknown): PegoNode[] | null => {
  if (!Array.isArray(value)) return null;
  const out: PegoNode[] = [];
  for (const item of value) {
    const result = nodeSchema.safeParse(item);
    if (!result.success || result.data.type === "page") return null;
    out.push(result.data);
  }
  return out;
};

/** The payload in clipboard data, or null when it is not ours or not valid. */
export const readPayload = (data: string): NodesPayload | null => {
  if (!data || data.length > MAX_PAYLOAD_CHARS) return null;
  try {
    const parsed = JSON.parse(data) as Partial<NodesPayload>;
    if (!parsed || parsed.version !== 1 || typeof parsed.docId !== "string") return null;
    const nodes = parseNodes(parsed.nodes);
    if (!nodes || countNodes(nodes) > MAX_PAYLOAD_NODES) return null;
    const detached = parsed.detached === undefined ? undefined : parseNodes(parsed.detached);
    if (detached === null || (detached && countNodes(detached) > MAX_PAYLOAD_NODES)) return null;
    const variables = variablesSchema.safeParse(parsed.variables ?? {});
    if (!variables.success) return null;
    const parents = Array.isArray(parsed.parents)
      ? parsed.parents.map((id) => (typeof id === "string" ? id : null))
      : [];
    return { version: 1, docId: parsed.docId, nodes, detached, variables: variables.data, parents };
  } catch {
    return null;
  }
};

/** Where a paste goes when the layers do not go back beside their originals. */
export type PasteTarget = {
  /** The shown page (top-level layers go there). */
  pageId: string;
  /** One selected frame or group receives the paste. */
  selection: readonly string[];
  /** The middle of the view, in canvas coordinates. */
  center: { x: number; y: number };
};

export type PastePlan = { ops: Op[]; select: string[]; label: string };

/** Offset of pasted copies from their originals. */
export const PASTE_OFFSET = 10;

const allRefsResolve = (doc: PegoDocument, node: PegoNode): boolean =>
  node.type === "ref"
    ? findNode(doc, node.ref)?.reusable === true
    : !isContainer(node) || node.children.every((child) => allRefsResolve(doc, child));

const numberOf = (doc: PegoDocument, value: unknown) =>
  typeof value === "number" ? value : resolveNumber(value as never, doc.variables, 0);

/** The selected frame or group a paste goes into, if exactly one is selected. */
const containerTarget = (doc: PegoDocument, selection: readonly string[]): string | null => {
  if (selection.length !== 1) return null;
  const node = findNode(doc, selection[0]!);
  return node && (node.type === "frame" || node.type === "group") ? node.id : null;
};

/** Move nodes (in their own coordinates) so their bounds are centered on `center`. */
const centered = (doc: PegoDocument, nodes: PegoNode[], center: { x: number; y: number }) => {
  const boxes = nodes.map((node) => {
    const x = numberOf(doc, node.x);
    const y = numberOf(doc, node.y);
    return {
      x,
      y,
      right: x + (typeof node.width === "number" ? node.width : 0),
      bottom: y + (typeof node.height === "number" ? node.height : 0),
    };
  });
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(...boxes.map((box) => box.right)) - left;
  const height = Math.max(...boxes.map((box) => box.bottom)) - top;
  const dx = Math.round(center.x - width / 2 - left);
  const dy = Math.round(center.y - height / 2 - top);
  return nodes.map(
    (node, index) => ({ ...node, x: boxes[index]!.x + dx, y: boxes[index]!.y + dy }) as PegoNode,
  );
};

/** The payload's layers as fresh copies (detached when they cannot keep their components), plus
 * the op that adds the variables another document is missing. Null for an empty payload. */
const prepareCopies = (
  doc: PegoDocument,
  payload: NodesPayload,
): { copies: PegoNode[]; ops: Op[] } | null => {
  const sameDoc = payload.docId === doc.id;
  const source = payload.nodes.map((node, index) =>
    sameDoc && allRefsResolve(doc, node) ? node : (payload.detached?.[index] ?? node),
  );
  if (source.length === 0) return null;
  const ops: Op[] = [];
  const missing = Object.entries(payload.variables).filter(([name]) => !doc.variables[name]);
  if (!sameDoc && missing.length > 0) {
    ops.push({ op: "setVariables", variables: Object.fromEntries(missing) });
  }
  return { copies: cloneAllWithFreshIds(source), ops };
};

/**
 * Copies of the payload's layers, as ops. In the same document each copy goes right after its
 * original, shifted a little (like Duplicate); with one frame or group selected the copies go in
 * there; otherwise they go to the middle of the view. Another document gets the detached layers
 * and the variables it does not have yet (its own variables of the same name win).
 */
export const pasteNodes = (
  doc: PegoDocument,
  payload: NodesPayload,
  target: PasteTarget,
): PastePlan | null => {
  const sameDoc = payload.docId === doc.id;
  const prepared = prepareCopies(doc, payload);
  if (!prepared) return null;
  const { copies, ops } = prepared;

  const into = containerTarget(doc, target.selection);
  const besideOriginals =
    sameDoc &&
    !into &&
    payload.nodes.every((node, index) => {
      const loc = findLocation(doc, node.id);
      return loc !== null && loc.parentId === (payload.parents[index] ?? loc.parentId);
    });

  if (besideOriginals) {
    // Highest index first: an insert never shifts the (old-document) index of a later one.
    const order = payload.nodes
      .map((original, index) => ({ index, loc: findLocation(doc, original.id)! }))
      .sort((a, b) => b.loc.index - a.loc.index);
    order.forEach(({ index, loc }) => {
      const copy = copies[index]!;
      ops.push({
        op: "insert",
        parentId: loc.parentId,
        index: loc.index + 1,
        node: {
          ...copy,
          x: numberOf(doc, copy.x) + PASTE_OFFSET,
          y: numberOf(doc, copy.y) + PASTE_OFFSET,
        } as PegoNode,
      });
    });
  } else if (into) {
    for (const copy of copies) ops.push({ op: "insert", parentId: into, node: copy });
  } else {
    for (const copy of centered(doc, copies, target.center)) {
      ops.push({ op: "insert", parentId: target.pageId, node: copy });
    }
  }
  return { ops, select: copies.map((copy) => copy.id), label: "Paste" };
};

const SVG_MARKUP = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

/** Pasted SVG markup as vector layers in the middle of the view (or the selected frame). */
export const pasteSvg = (
  doc: PegoDocument,
  markup: string,
  target: PasteTarget,
): PastePlan | null => {
  if (!SVG_MARKUP.test(markup)) return null;
  let node: PegoNode;
  try {
    node = svgToNode(markup, collectDocIds(doc), "SVG");
  } catch {
    return null;
  }
  const into = containerTarget(doc, target.selection);
  const placed = into ? node : centered(doc, [node], target.center)[0]!;
  return {
    ops: [{ op: "insert", parentId: into ?? target.pageId, node: placed }],
    select: [node.id],
    label: "Paste SVG",
  };
};

/** Pasted plain text as a text layer in the middle of the view (or the selected frame). */
export const pasteText = (
  doc: PegoDocument,
  text: string,
  target: PasteTarget,
): PastePlan | null => {
  const content = text.replace(/\r\n?/g, "\n").trim();
  if (!content) return null;
  const into = containerTarget(doc, target.selection);
  const node = {
    id: createId(),
    type: "text",
    name: content.split("\n")[0]!.slice(0, 40),
    x: 0,
    y: 0,
    content,
    fontFamily: "Inter",
    fontSize: DEFAULT_FONT_SIZE,
    fill: createTextColor(doc, into),
  } as PegoNode;
  const placed = into
    ? node
    : ({ ...node, x: Math.round(target.center.x), y: Math.round(target.center.y) } as PegoNode);
  return {
    ops: [{ op: "insert", parentId: into ?? target.pageId, node: placed }],
    select: [placed.id],
    label: "Paste text",
  };
};

/** Top-left corner of the layers' bounds, in their own coordinates. */
const topLeftOf = (doc: PegoDocument, nodes: readonly PegoNode[]) => ({
  x: Math.min(...nodes.map((node) => numberOf(doc, node.x))),
  y: Math.min(...nodes.map((node) => numberOf(doc, node.y))),
});

/** Move nodes so the top-left of their bounds lands on `at` (in their parent's coordinates). */
const shiftedTo = (doc: PegoDocument, nodes: PegoNode[], at: { x: number; y: number }) => {
  const corner = topLeftOf(doc, nodes);
  const dx = Math.round(at.x - corner.x);
  const dy = Math.round(at.y - corner.y);
  return nodes.map(
    (node) =>
      ({ ...node, x: numberOf(doc, node.x) + dx, y: numberOf(doc, node.y) + dy }) as PegoNode,
  );
};

/** What a paste at a point needs besides the point: the shown page and the selection. */
export type PasteAtTarget = { pageId: string; selection: readonly string[] };

/**
 * Paste here: copies whose bounds start at `at` (canvas coordinates). They go into the selected
 * frame or group when exactly one is selected (like ⌘V), otherwise onto the page. A flex frame
 * places its children itself, so nothing is positioned there (unless a copy is absolute).
 */
export const pasteNodesAt = (
  doc: PegoDocument,
  layout: Layout,
  payload: NodesPayload,
  at: { x: number; y: number },
  target: PasteAtTarget,
): PastePlan | null => {
  const prepared = prepareCopies(doc, payload);
  if (!prepared) return null;
  const { ops } = prepared;
  const into = containerTarget(doc, target.selection);
  const parent = into ? findNode(doc, into) : null;
  const flexParent = prepared.copies.every((node) => placedByLayout(parent, node));
  const box = into ? layout.get(into) : undefined;
  const placed = flexParent
    ? prepared.copies
    : shiftedTo(doc, prepared.copies, { x: at.x - (box?.x ?? 0), y: at.y - (box?.y ?? 0) });
  for (const node of placed) ops.push({ op: "insert", parentId: into ?? target.pageId, node });
  return { ops, select: placed.map((node) => node.id), label: "Paste here" };
};

/**
 * Paste to replace: every selected layer is swapped for a copy of the payload's layers (all of
 * them), at the same parent and index, with the bounds starting where the old layer started.
 */
export const replaceWithNodes = (
  doc: PegoDocument,
  payload: NodesPayload,
  ids: readonly string[],
): PastePlan | { error: string } => {
  const locs = topmostSelected(doc, ids)
    .flatMap((id) => {
      const loc = findLocation(doc, id);
      return loc && loc.node.type !== "page" ? [loc] : [];
    })
    // Last first: an earlier sibling's index stays valid.
    .sort((a, b) => b.index - a.index);
  if (locs.length === 0) return { error: "Select the layers to replace first." };
  const first = prepareCopies(doc, payload);
  if (!first) return { error: "Nothing to paste." };
  const ops: Op[] = [...first.ops];
  const select: string[] = [];
  locs.forEach((loc, round) => {
    const copies = round === 0 ? first.copies : (prepareCopies(doc, payload)?.copies ?? []);
    const at = { x: numberOf(doc, loc.node.x), y: numberOf(doc, loc.node.y) };
    shiftedTo(doc, copies, at).forEach((node, offset) => {
      ops.push({ op: "insert", parentId: loc.parentId, index: loc.index + offset, node });
      select.push(node.id);
    });
    ops.push({ op: "delete", id: loc.node.id });
  });
  return { ops, select, label: "Paste to replace" };
};

/** Clipboard text as a payload of one layer (SVG markup or a text layer); null when empty. */
export const payloadFromText = (doc: PegoDocument, text: string): NodesPayload | null => {
  const target = { pageId: "", selection: [], center: { x: 0, y: 0 } };
  const plan = pasteSvg(doc, text, target) ?? pasteText(doc, text, target);
  const op = plan?.ops[0];
  if (op?.op !== "insert") return null;
  return { version: 1, docId: "", nodes: [op.node], variables: {}, parents: [] };
};
