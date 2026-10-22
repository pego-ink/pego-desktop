import type { Skill } from "./types";

/** Markdown for one skill: body, checklist, suggested styles. Used by MCP resources and run prompts. */
export const skillToMarkdown = (skill: Skill): string => {
  const parts = [`# ${skill.title}`, skill.description, skill.content.trim()];
  if (skill.checklist.length > 0) {
    parts.push(
      `## Checklist before reporting done\n\n${skill.checklist.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  if (skill.styles.length > 0) {
    parts.push(`## Suggested styles\n\n${skill.styles.join(", ")} (see list_styles / get_style)`);
  }
  return parts.join("\n\n");
};
