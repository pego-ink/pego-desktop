import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js";
import { guides } from "@pego/agent";
import type { CallTool, ToolSource } from "./editor-hub";

export const DOCUMENT_URI = "pego://document";
const GUIDE_PREFIX = "pego://guides/";

export const listPegoResources = (): Resource[] => [
  {
    uri: DOCUMENT_URI,
    name: "document",
    title: "Current document",
    description: "The serialized document open in the connected Pego editor.",
    mimeType: "text/plain",
  },
  ...guides.map((guide) => ({
    uri: `${GUIDE_PREFIX}${guide.id}`,
    name: guide.id,
    title: guide.title,
    description: guide.description,
    mimeType: "text/markdown",
  })),
];

/** Read a resource; returns `undefined` for an unknown URI. Editor errors come back as text. */
export const readPegoResource = async (
  uri: string,
  callTool: CallTool,
  source: ToolSource,
): Promise<ReadResourceResult | undefined> => {
  if (uri === DOCUMENT_URI) {
    const outcome = await callTool("get_document", {}, source);
    const text = outcome.isError ? `Error: ${outcome.content}` : outcome.content;
    return { contents: [{ uri, mimeType: "text/plain", text }] };
  }
  if (!uri.startsWith(GUIDE_PREFIX)) return undefined;
  const guide = guides.find((entry) => `${GUIDE_PREFIX}${entry.id}` === uri);
  if (!guide) return undefined;
  return { contents: [{ uri, mimeType: "text/markdown", text: guide.content }] };
};
