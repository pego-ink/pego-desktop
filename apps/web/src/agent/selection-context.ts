import { findNode, type PegoDocument } from "@pego/doc";

/** Most selected layers named in the prompt; the rest are counted. */
const MAX_LISTED = 30;

/**
 * The request context for a run started with layers selected: which layers the user means, so
 * the agent edits exactly those (no guessing with get_selection). Empty without a selection.
 */
export const selectionContext = (doc: PegoDocument, selection: readonly string[]): string => {
  const nodes = selection.flatMap((id) => findNode(doc, id) ?? []);
  if (nodes.length === 0) return "";
  const lines = nodes
    .slice(0, MAX_LISTED)
    .map((node) => `- ${node.id}: ${node.name ? `"${node.name}"` : "(unnamed)"} (${node.type})`);
  if (nodes.length > MAX_LISTED) lines.push(`- ... and ${nodes.length - MAX_LISTED} more`);
  return [
    `The user selected ${nodes.length === 1 ? "this layer" : `these ${nodes.length} layers`} on the canvas. The request is about ${nodes.length === 1 ? "it" : "them"}: edit ${nodes.length === 1 ? "it (and its children)" : "them (and their children)"}, and leave other layers alone unless the request says otherwise.`,
    ...lines,
  ].join("\n");
};

/** The prompt the agent receives: the selection context, then the user's words. */
export const withSelectionContext = (prompt: string, context: string): string =>
  context ? `${context}\n\nRequest: ${prompt}` : prompt;
