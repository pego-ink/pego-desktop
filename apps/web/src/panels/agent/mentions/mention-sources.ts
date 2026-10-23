import {
  isContainer,
  pageOrFirst,
  type PegoDocument,
  type PegoNode,
  type PegoNodeType,
} from "@pego/doc";
import type { MentionRef, Skill } from "@pego/agent";
import { pickableSkills, pickableStyles } from "@/panels/agent/skill-chip";

export type MentionSection =
  "Selection" | "Browser" | "Layers" | "Components" | "Skills" | "Styles" | "Attachments";

/** One row of the @ popover. */
export type MentionItem = {
  /** Unique within one suggestion list. */
  key: string;
  section: MentionSection;
  ref: MentionRef;
  /** Chip and row label (the layer or skill name). */
  title: string;
  /** Muted detail on the row (layer type, skill description). */
  detail?: string;
  /** A layer row's type, for its icon. */
  nodeType?: PegoNodeType;
};

export type MentionSources = {
  doc: PegoDocument;
  /** The page on the canvas: its layers are offered (components come from every page). */
  pageId: string | null;
  selection: readonly string[];
  attachments: readonly { id: string; name: string }[];
  /** The element picked in the in-app browser, if any. */
  browser?: { selector: string; label: string } | null;
};

/** Rows per section, so a big document does not drown the skills. */
const LIMITS: Record<MentionSection, number> = {
  Selection: 1,
  Browser: 1,
  Layers: 8,
  Components: 6,
  Skills: 8,
  Styles: 10,
  Attachments: 6,
};

/** Case- and diacritic-insensitive form for search (same rule as the style search). */
export const foldForSearch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const matches = (needle: string, ...haystack: (string | undefined)[]) =>
  !needle || foldForSearch(haystack.filter(Boolean).join(" ")).includes(needle);

/** Every node in tree order (instances count as one layer; their insides are not listed). */
const walk = (nodes: readonly PegoNode[], out: PegoNode[] = []): PegoNode[] => {
  for (const node of nodes) {
    out.push(node);
    if (isContainer(node)) walk(node.children, out);
  }
  return out;
};

/**
 * What the @ popover offers for `query`, section by section: the current selection (as one
 * chip), the element picked in the browser, layers of the shown page, components of the document and attached images. Skills and
 * styles are the "/" popover's (`slashSuggestions`).
 */
export const mentionSuggestions = (query: string, sources: MentionSources): MentionItem[] => {
  const needle = foldForSearch(query);
  const items: MentionItem[] = [];
  const push = (section: MentionSection, list: MentionItem[]) =>
    items.push(...list.slice(0, LIMITS[section]));

  if (sources.selection.length > 0 && matches(needle, "selection selected")) {
    const count = sources.selection.length;
    push("Selection", [
      {
        key: `selection:${sources.selection.join(",")}`,
        section: "Selection",
        ref: { kind: "layer", ids: [...sources.selection] },
        title: count === 1 ? "Selection" : `Selection (${count} layers)`,
        detail: "What is selected on the canvas",
      },
    ]);
  }

  const picked = sources.browser;
  if (picked && matches(needle, "browser element", picked.label)) {
    push("Browser", [
      {
        key: `browser:${picked.selector}`,
        section: "Browser",
        ref: { kind: "browser", selector: picked.selector, label: picked.label },
        title: picked.label,
        detail: "Picked in the browser",
      },
    ]);
  }

  push(
    "Layers",
    walk(pageOrFirst(sources.doc, sources.pageId).children)
      .filter((node) => matches(needle, node.name, node.type))
      .map((node) => ({
        key: `layer:${node.id}`,
        section: "Layers" as const,
        ref: { kind: "layer" as const, ids: [node.id] },
        title: node.name ?? node.type,
        detail: node.type,
        nodeType: node.type,
      })),
  );
  push(
    "Components",
    walk(sources.doc.children)
      .filter((node) => node.reusable === true && matches(needle, node.name, node.type))
      .map((node) => ({
        key: `component:${node.id}`,
        section: "Components" as const,
        ref: { kind: "component" as const, id: node.id },
        title: node.name ?? node.type,
        detail: "component",
      })),
  );
  push(
    "Attachments",
    sources.attachments
      .filter((item) => matches(needle, item.name, item.id))
      .map((item) => ({
        key: `attachment:${item.id}`,
        section: "Attachments" as const,
        ref: { kind: "attachment" as const, id: item.id },
        title: item.name,
        detail: "image",
      })),
  );
  return items;
};

/** What the "/" popover offers for `query`: design skills, then styles. */
export const slashSuggestions = (query: string, skills: readonly Skill[]): MentionItem[] => {
  const needle = foldForSearch(query);
  const items: MentionItem[] = [];
  const push = (section: MentionSection, list: MentionItem[]) =>
    items.push(...list.slice(0, LIMITS[section]));
  const skillItems = (list: readonly Skill[], kind: "skill" | "style"): MentionItem[] =>
    list
      .filter((skill) => matches(needle, skill.title, skill.id.replace(/-/g, " ")))
      .map((skill) => ({
        key: `${kind}:${skill.id}`,
        section: kind === "skill" ? "Skills" : "Styles",
        ref: { kind, id: skill.id },
        title: skill.title,
        detail: skill.description,
      }));
  push("Skills", skillItems(pickableSkills(skills), "skill"));
  push("Styles", skillItems(pickableStyles(skills), "style"));
  return items;
};
