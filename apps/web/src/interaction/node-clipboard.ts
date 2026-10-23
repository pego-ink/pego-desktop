import {
  cloneWithFreshIds,
  collectDocIds,
  createId,
  findLocation,
  findNode,
  isContainer,
  resolveInstance,
  resolveNumber,
  type Op,
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
  /** The same layers with every instance replaced by what it shows (for another document). */
  detached: PegoNode[];
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
  const detached = nodes.map((node) => detachAll(doc, node));
  // Instances use their component's variables too: read them from the detached copies.
  const variables: Variables = {};
  for (const name of usedVariables([nodes, detached])) {
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

/** The payload in clipboard data, or null when it is not ours. */
export const readPayload = (data: string): NodesPayload | null => {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Partial<NodesPayload>;
    if (parsed.version !== 1 || typeof parsed.docId !== "string") return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.detached)) return null;
    return {
      version: 1,
      docId: parsed.docId,
      nodes: parsed.nodes,
      detached: parsed.detached,
      variables: parsed.variables ?? {},
      parents: Array.isArray(parsed.parents) ? parsed.parents : [],
    };
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
  const source = payload.nodes.map((node, index) =>
    sameDoc && allRefsResolve(doc, node) ? node : (payload.detached[index] ?? node),
  );
  if (source.length === 0) return null;
  const copies = source.map((node) => cloneWithFreshIds(node));
  const ops: Op[] = [];

  const missing = Object.entries(payload.variables).filter(([name]) => !doc.variables[name]);
  if (!sameDoc && missing.length > 0) {
    ops.push({ op: "setVariables", variables: Object.fromEntries(missing) });
  }

  const into = containerTarget(doc, target.selection);
  const besideOriginals =
    sameDoc &&
    !into &&
    payload.nodes.every((node, index) => {
      const loc = findLocation(doc, node.id);
      return loc !== null && loc.parentId === (payload.parents[index] ?? loc.parentId);
    });

  if (besideOriginals) {
    payload.nodes.forEach((original, index) => {
      const loc = findLocation(doc, original.id)!;
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
