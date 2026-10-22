import { coreSkill, findSkill, skillToMarkdown, suggestSkills, type Skill } from "@pego/agent";

/**
 * Which skills apply to a run. `selectedId`: undefined = auto-detect from the prompt, null =
 * none beyond core, string = that skill. The core skill (if any) always comes first.
 */
export const resolveRunSkills = (prompt: string, selectedId?: string | null): Skill[] => {
  const core = coreSkill();
  const chosen =
    selectedId === undefined
      ? suggestSkills(prompt, { limit: 1 })
      : selectedId === null
        ? []
        : [findSkill(selectedId)].filter((skill): skill is Skill => skill !== undefined);
  return [...(core ? [core] : []), ...chosen.filter((skill) => skill.id !== core?.id)];
};

/** Run-log line(s): one per chosen skill, or the core skill when it is the only one. */
export const skillLogLines = (skills: Skill[]): string[] => {
  const chosen = skills.filter((skill) => !skill.core);
  return (chosen.length > 0 ? chosen : skills).map((skill) => `Using skill: ${skill.title}`);
};

/**
 * Skill text for the USER turn of a model call. The system prompt stays byte-identical across
 * runs (prompt caching); per-request skill content belongs after it, in the messages.
 */
export const skillsBlock = (skills: Skill[]): string =>
  skills.length === 0
    ? ""
    : [
        "Design skills for this request. Follow them while designing and go through each checklist before reporting done.",
        ...skills.map(skillToMarkdown),
      ].join("\n\n---\n\n");

/** One line for local coding agents, which load the skills themselves through get_skill. */
export const skillPromptPrefix = (skills: Skill[]): string =>
  skills.length === 0
    ? ""
    : `Use Pego skills: ${skills.map((skill) => skill.id).join(", ")} (call get_skill). Reply and write design copy in the language of the request below.`;
