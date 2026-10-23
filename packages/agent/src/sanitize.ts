/**
 * Untrusted strings (layer names, page titles, picked elements) end up inside the agent's prompt.
 * `sanitizeLabel` makes one safe to quote there: a single line, no control characters, and no
 * backticks or double quotes that could close the quoting around it.
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\uE000\uE001]/g;

/**
 * One line of at most `max` characters: control characters and newlines become spaces, runs of
 * whitespace collapse, backticks become `’` and double quotes `”`, and a longer text ends in `…`.
 */
export const sanitizeLabel = (text: string, max = 80): string => {
  const clean = text
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .replace(/`/g, "’")
    .replace(/"/g, "”")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};
