/**
 * A ready-made design skill: opinionated, Pego-specific guidance for one kind of design,
 * written to keep agents away from generic "AI slop". Served through the `get_skill` tool,
 * as MCP resources (`pego://skills/<id>`) and auto-selected from the user's prompt.
 */
export type Skill = {
  /** kebab-case id, e.g. "landing-page". */
  id: string;
  title: string;
  /** One line: what the skill is for. */
  description: string;
  /** Words/phrases (English and Indonesian) that suggest this skill in a prompt. */
  keywords: string[];
  /** Markdown body: purpose, workflow in Pego, structure recipes, rules, anti-patterns. */
  content: string;
  /** Concrete checks the agent verifies before reporting done (screenshot + check_layout). */
  checklist: string[];
  /** Style preset ids (see ../styles) that suit this skill, best first. */
  styles: string[];
  /** True for the core skill that applies to every design. */
  core?: boolean;
};
