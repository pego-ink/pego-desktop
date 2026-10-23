import {
  coreSkills,
  findSkill,
  skillToMarkdown,
  suggestSkills,
  suggestStyle,
  type Skill,
} from "@pego/agent";

const pickById = (id: string, category: "design" | "style"): Skill | undefined => {
  const skill = findSkill(id);
  return skill && !skill.core && (skill.category ?? "design") === category ? skill : undefined;
};

/**
 * Which skills apply to a run: [...core, design?, style?]. `selectedId` (design) and
 * `selectedStyleId`: undefined = auto-detect from the prompt, null = none, string = that skill.
 * An id of the wrong category is ignored. The core skills always come first.
 */
export const resolveRunSkills = (
  prompt: string,
  selectedId?: string | null,
  selectedStyleId?: string | null,
): Skill[] => {
  const design =
    selectedId === undefined
      ? suggestSkills(prompt, { limit: 1 })[0]
      : selectedId === null
        ? undefined
        : pickById(selectedId, "design");
  const style =
    selectedStyleId === undefined
      ? suggestStyle(prompt)
      : selectedStyleId === null
        ? undefined
        : pickById(selectedStyleId, "style");
  return [...coreSkills(), ...(design ? [design] : []), ...(style ? [style] : [])];
};

/** Run-log line(s): one per chosen skill ("Using style:" for a style), or the core skill when it is the only one. */
export const skillLogLines = (skills: Skill[]): string[] => {
  const chosen = skills.filter((skill) => !skill.core);
  return (chosen.length > 0 ? chosen : skills).map(
    (skill) => `Using ${skill.category === "style" ? "style" : "skill"}: ${skill.title}`,
  );
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
