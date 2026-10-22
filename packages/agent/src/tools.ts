import type { ToolSpec } from "./types";

/** Every tool the agent can use, shared by the in-browser loop, MCP and the Agent SDK. */
export const agentTools: ToolSpec[] = [];

export const toolByName = (name: string): ToolSpec | undefined =>
  agentTools.find((tool) => tool.name === name);
