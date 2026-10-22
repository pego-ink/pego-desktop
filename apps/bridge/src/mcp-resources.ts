import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js";
import { skills, skillToMarkdown } from "@pego/agent";
import type { CallTool, ToolSource } from "./editor-hub";

export const DOCUMENT_URI = "pego://document";
const SKILL_PREFIX = "pego://skills/";

export const listPegoResources = (): Resource[] => [
  {
    uri: DOCUMENT_URI,
    name: "document",
    title: "Current document",
    description: "The serialized document open in the connected Pego editor.",
    mimeType: "text/plain",
  },
  ...skills.map((skill) => ({
    uri: `${SKILL_PREFIX}${skill.id}`,
    name: skill.id,
    title: skill.title,
    description: skill.description,
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
  if (!uri.startsWith(SKILL_PREFIX)) return undefined;
  const skill = skills.find((entry) => `${SKILL_PREFIX}${entry.id}` === uri);
  if (!skill) return undefined;
  return { contents: [{ uri, mimeType: "text/markdown", text: skillToMarkdown(skill) }] };
};
