import { isContainer, type Layout, type PegoDocument, type PegoNode } from "@pego/doc";

export type NodeMatch = {
  id: string;
  type: string;
  name?: string;
  parentId: string | null;
  box?: { x: number; y: number; width: number; height: number };
  text?: string;
  component?: boolean;
};

export type NodeQuery = {
  query?: string;
  type?: string;
  name?: string;
  text?: string;
  withinId?: string;
  limit: number;
};

const SNIPPET = 80;

const textOf = (node: PegoNode): string | undefined =>
  node.type === "text" ? node.content : undefined;

const includes = (haystack: string | undefined, needle: string): boolean =>
  haystack !== undefined && haystack.toLowerCase().includes(needle.toLowerCase());

/** Search document nodes (not expanded instance internals). Returns matches plus the real total. */
export const findNodes = (
  doc: PegoDocument,
  layout: Layout | undefined,
  q: NodeQuery,
): { matches: NodeMatch[]; total: number } => {
  const matches: NodeMatch[] = [];
  let total = 0;

  const matchesNode = (node: PegoNode): boolean => {
    if (q.type && node.type !== q.type) return false;
    if (q.name && !includes(node.name, q.name)) return false;
    if (q.text && !includes(textOf(node), q.text)) return false;
    if (q.query) {
      const iconName = node.type === "icon" ? node.iconName : undefined;
      const hit = [node.name, textOf(node), node.id, iconName, node.type].some((field) =>
        includes(field, q.query as string),
      );
      if (!hit) return false;
    }
    return true;
  };

  const visit = (node: PegoNode, parentId: string | null, active: boolean): void => {
    const nowActive = active || q.withinId === undefined || node.id === q.withinId;
    if (nowActive && matchesNode(node)) {
      total += 1;
      if (matches.length < q.limit) {
        const box = layout?.get(node.id);
        const text = textOf(node);
        matches.push({
          id: node.id,
          type: node.type,
          ...(node.name ? { name: node.name } : {}),
          parentId,
          ...(box ? { box } : {}),
          ...(text ? { text: text.length > SNIPPET ? `${text.slice(0, SNIPPET)}...` : text } : {}),
          ...(node.reusable ? { component: true } : {}),
        });
      }
    }
    if (isContainer(node)) for (const child of node.children) visit(child, node.id, nowActive);
  };
  for (const node of doc.children) visit(node, null, false);
  return { matches, total };
};

const words = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);

const isSubsequence = (needle: string, haystack: string): boolean => {
  let i = 0;
  for (const char of haystack) if (char === needle[i]) i += 1;
  return i === needle.length;
};

/** Score one icon name for a query; 0 means no match. Higher is better. */
export const scoreIcon = (name: string, query: string): number => {
  const queryWords = words(query);
  if (queryWords.length === 0) return 0;
  const kebab = queryWords.join("-");
  if (name === kebab) return 1000;
  const tokens = name.split("-");
  let score = 0;
  for (const word of queryWords) {
    const exact = tokens.includes(word);
    if (exact) score += 100;
    else if (tokens.some((token) => token.startsWith(word))) score += 60;
    else if (name.includes(word)) score += 30;
    else if (word.length >= 3 && isSubsequence(word, name)) score += 10;
    else return 0; // every query word must match something
  }
  if (name.startsWith(kebab)) score += 300;
  else if (tokens[0] && queryWords[0] && tokens[0].startsWith(queryWords[0])) score += 40;
  return score;
};

/** Fuzzy icon search: prefix and whole-word matches rank first, shorter names break ties. */
export const searchIcons = (icons: string[], query: string, limit: number): string[] =>
  icons
    .map((name) => ({ name, score: scoreIcon(name, query) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((entry) => entry.name);
