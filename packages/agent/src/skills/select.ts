import { skills as registry } from "./index";
import type { Skill } from "./types";

export type SuggestOptions = {
  /** Max skills returned. Default 2. */
  limit?: number;
  /** Skill pool to rank (default: the built-in registry). Core skills are always excluded. */
  skills?: readonly Skill[];
};

const DEFAULT_LIMIT = 2;

/** Lowercase, strip diacritics, split into words (letters and digits only). */
const words = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Light stemming so "dashboards" matches "dashboard": English plurals (ies, sses, es after
 * x/ch/sh/z, s) and the Indonesian possessive suffix "nya" ("kopinya" -> "kopi").
 */
export const stem = (word: string): string => {
  if (word.length > 5 && word.endsWith("nya")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ss|x|ch|sh|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) {
    return word.slice(0, -1);
  }
  return word;
};

const stemmed = (text: string): string[] => words(text).map(stem);

/** True when `needle` appears as a run of consecutive words in `haystack`. */
const containsRun = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
};

/**
 * Score of one skill: each distinct keyword (or the title) that occurs in the prompt as whole
 * words adds its word count, so a phrase like "landing page" outweighs a bare "page".
 */
const scoreSkill = (promptWords: readonly string[], skill: Skill): number => {
  const seen = new Set<string>();
  let score = 0;
  for (const phrase of [...skill.keywords, skill.title]) {
    const needle = stemmed(phrase);
    const key = needle.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    if (containsRun(promptWords, needle)) score += needle.length;
  }
  return score;
};

/**
 * Rank non-core skills for a prompt by keyword/phrase matching (English and Indonesian,
 * case- and diacritic-insensitive, whole words, simple stemming). Returns [] when nothing
 * matches. Ties keep registry order.
 */
export const suggestSkills = (prompt: string, options: SuggestOptions = {}): Skill[] => {
  const { limit = DEFAULT_LIMIT, skills = registry } = options;
  const promptWords = stemmed(prompt);
  if (promptWords.length === 0 || limit <= 0) return [];
  return skills
    .filter((skill) => !skill.core)
    .map((skill, index) => ({ skill, index, score: scoreSkill(promptWords, skill) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.skill);
};
