import { toast } from "sonner";
import { findNode, type PegoNode } from "@pego/doc";
import { sanitizeLabel } from "@pego/agent";
import { useDocumentStore } from "@/store/use-document-store";
import { useFileStore } from "@/persistence/use-file-store";
import { liveProject } from "@/workspace/use-workspace-store";

/** Most nodes listed by name; the ids line always has all of them. */
const MAX_LISTED = 40;

export type AgentReference = {
  project: { id: string; name: string } | null;
  /** Absolute path on disk, or a file name when only the browser knows the file. */
  file: string | null;
  documentName: string;
  nodes: Pick<PegoNode, "id" | "type" | "name">[];
};

const isAbsolutePath = (file: string) => file.startsWith("/") || /^[a-z]:[\\/]/i.test(file);

/**
 * Text to paste into Claude Code (or another agent with the Pego MCP server): which project and
 * file the nodes are in, and their ids, so an instruction can target exactly them.
 */
export const formatAgentReference = ({ project, file, documentName, nodes }: AgentReference) => {
  // Names (and ids) come from the file, which may be someone else's: keep each on one line.
  const lines = [
    project
      ? `Pego project: ${sanitizeLabel(project.name) || "(unnamed)"} (id ${sanitizeLabel(project.id, 64)})`
      : `Pego document: ${sanitizeLabel(documentName) || "(unnamed)"} (not in a project)`,
  ];
  if (file) lines.push(`File: ${file}`);
  lines.push(`Node IDs: ${nodes.map((node) => sanitizeLabel(node.id, 64)).join(", ")}`);
  if (nodes.length > 1 || nodes[0]?.name) {
    lines.push("Nodes:");
    for (const node of nodes.slice(0, MAX_LISTED)) {
      lines.push(
        `- ${sanitizeLabel(node.id, 64)}: ${sanitizeLabel(node.name ?? "") || "(unnamed)"} (${node.type})`,
      );
    }
    if (nodes.length > MAX_LISTED) lines.push(`- ... and ${nodes.length - MAX_LISTED} more`);
  }
  lines.push(
    project
      ? `With the pego MCP tools: pass project "${project.id}" to every tool call (no need to open it in the window), then edit these nodes by id.`
      : file && isAbsolutePath(file)
        ? `With the pego MCP tools: open_document "${file}" first, then edit these nodes by id.`
        : "With the pego MCP tools: the nodes are in the document shown in the Pego editor.",
  );
  return lines.join("\n");
};

/** The reference for the current selection, or null when nothing is selected. */
export const selectionReference = (): string | null => {
  const { doc, selection } = useDocumentStore.getState();
  const nodes = selection.flatMap((id) => findNode(doc, id) ?? []);
  if (nodes.length === 0) return null;
  const project = liveProject();
  const { bridgePath, fileName } = useFileStore.getState();
  return formatAgentReference({
    project: project ? { id: project.id, name: project.name } : null,
    file: bridgePath ?? fileName,
    documentName: doc.name,
    nodes: nodes.map(({ id, type, name }) => ({ id, type, name })),
  });
};

/** Toast text for a copied reference: says when the clipboard now holds a file path. */
export const copiedDescription = (text: string): string => {
  const head = text.split("\n")[0] ?? "";
  return /^File: /m.test(text) ? `${head}. Includes the project's file path.` : head;
};

/** Copy for AI (⌘⇧C): the selection's project, file and node ids for an agent instruction. */
export const copySelectionForAgent = async (): Promise<boolean> => {
  const text = selectionReference();
  if (!text) {
    toast("Select one or more layers to copy their ids for the agent.");
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    const count = useDocumentStore.getState().selection.length;
    toast(`Copied ${count} node id${count === 1 ? "" : "s"} for AI`, {
      description: copiedDescription(text),
    });
    return true;
  } catch {
    toast("Could not write to the clipboard.");
    return false;
  }
};
