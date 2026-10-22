import type { ToolTarget } from "@pego/agent";
import { findProject, listProjects } from "./projects";

/** The optional argument every Pego tool takes over the terminal MCP endpoint. */
export const PROJECT_PARAM = {
  type: "string",
  description:
    "Project id or name (from list_projects). Works on that project's design even when the Pego window shows another one; edits are saved to its project.pego. Omit to use the shown document.",
} as const;

/** A tool's JSON Schema with the optional `project` argument added. */
export const withProjectParam = <S extends Record<string, unknown>>(schema: S): S => {
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  return { ...schema, properties: { ...properties, project: PROJECT_PARAM } };
};

/** Split `project` off a tool input (the tools themselves do not know it). */
export const takeProjectArg = (
  input: unknown,
): { project: string | null; input: unknown; invalid?: boolean } => {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("project" in input)
  ) {
    return { project: null, input };
  }
  const { project, ...rest } = input as Record<string, unknown>;
  if (typeof project !== "string" || !project.trim()) {
    return { project: null, input: rest, invalid: project !== undefined && project !== null };
  }
  return { project: project.trim(), input: rest };
};

/** The project a `project` argument names, or a readable reason it does not name exactly one. */
export const resolveProjectTarget = async (
  designDir: string | null,
  query: string,
): Promise<{ target: ToolTarget } | { error: string }> => {
  if (!designDir) return { error: "The bridge has no design folder, so there are no projects." };
  const projects = await listProjects(designDir);
  const found = findProject(projects, query);
  if ("project" in found) {
    const { id, name, dir, mainFile } = found.project;
    return { target: { project: { id, name, dir, mainFile } } };
  }
  const list = (found.matches.length > 1 ? found.matches : projects)
    .map((project) => `- ${project.name} (id ${project.id})`)
    .join("\n");
  return {
    error:
      found.matches.length > 1
        ? `"${query}" matches several projects; pass an id:\n${list}`
        : `No project "${query}". Projects:\n${list || "- (none)"}`,
  };
};
