import { z } from "zod";
import { findNode, type PegoDocument, type PegoNode } from "@pego/doc";
import { findSkill } from "./skills/index";

/**
 * Mentions: things the user points at in a prompt ("make @Hero Section dark, in @Bauhaus"), so
 * the agent works on exactly those instead of guessing. A mention stores ids only; names and
 * types are read from the document when the prompt is sent, so they never go stale.
 */

const id = z.string().min(1).max(128);

export const mentionRefSchema = z.discriminatedUnion("kind", [
  /** One or more canvas layers (a chip made from the selection holds several). */
  z.object({ kind: z.literal("layer"), ids: z.array(id).min(1).max(500) }),
  /** A reusable node (component) of the document. */
  z.object({ kind: z.literal("component"), id }),
  /** A design skill or a style, like the composer's skill chip (one run only). */
  z.object({ kind: z.literal("skill"), id }),
  z.object({ kind: z.literal("style"), id }),
  /** An image attached to the prompt ("att-1"). */
  z.object({ kind: z.literal("attachment"), id }),
]);

export type MentionRef = z.infer<typeof mentionRefSchema>;
export type MentionKind = MentionRef["kind"];

export const mentionRefsSchema = z.array(mentionRefSchema).max(100);

/**
 * A prompt with mentions. Each mention sits in `text` as a token built by `mentionToken`; the
 * token's number is the mention's index in `mentions`.
 */
export type PromptWithMentions = { text: string; mentions: MentionRef[] };

/** Private-use characters around a mention's index, so typed text can never look like a token. */
const TOKEN_OPEN = "\uE000";
const TOKEN_CLOSE = "\uE001";
const TOKEN_PATTERN = new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, "g");

export const mentionToken = (index: number): string => `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;

/** Same mention, written twice: a layer chip is the same when it names the same ids. */
export const mentionKey = (ref: MentionRef): string =>
  ref.kind === "layer" ? `layer:${[...ref.ids].sort().join(",")}` : `${ref.kind}:${ref.id}`;

/** What the agent needs to resolve mentions that live outside the document. */
export type MentionScope = {
  /** Ids of the images attached to this prompt. */
  attachments?: readonly { id: string; name: string }[];
};

const isComponent = (node: PegoNode | null | undefined): node is PegoNode =>
  node != null && node.reusable === true;

const skillOf = (skillId: string, category: "design" | "style") => {
  const skill = findSkill(skillId);
  return skill && !skill.core && (skill.category ?? "design") === category ? skill : undefined;
};

/**
 * The mentions that still point at something, deduplicated: layers keep the ids that exist,
 * components must be reusable nodes, skills and styles must be known (of the right kind), and
 * attachments must be attached to this prompt. Anything else is dropped.
 */
export const resolveMentions = (
  doc: PegoDocument,
  mentions: readonly MentionRef[],
  scope: MentionScope = {},
): MentionRef[] => {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  const keep = (ref: MentionRef): MentionRef | null => {
    if (ref.kind === "layer") {
      const ids = [...new Set(ref.ids)].filter((nodeId) => findNode(doc, nodeId) != null);
      return ids.length > 0 ? { kind: "layer", ids } : null;
    }
    if (ref.kind === "component") return isComponent(findNode(doc, ref.id)) ? ref : null;
    if (ref.kind === "skill") return skillOf(ref.id, "design") ? ref : null;
    if (ref.kind === "style") return skillOf(ref.id, "style") ? ref : null;
    return scope.attachments?.some((item) => item.id === ref.id) ? ref : null;
  };
  for (const ref of mentions) {
    const kept = keep(ref);
    if (!kept) continue;
    const key = mentionKey(kept);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kept);
  }
  return out;
};

const nodeName = (node: PegoNode): string => node.name ?? node.type;

/** A chip's label for people (the composer and the log): the name, without ids. */
export const mentionTitle = (
  doc: PegoDocument,
  ref: MentionRef,
  scope: MentionScope = {},
): string | null => {
  if (ref.kind === "layer") {
    const nodes = ref.ids.flatMap((nodeId) => findNode(doc, nodeId) ?? []);
    if (nodes.length === 0) return null;
    const first = nodeName(nodes[0]!);
    return nodes.length === 1 ? first : `${first} +${nodes.length - 1}`;
  }
  if (ref.kind === "component") {
    const node = findNode(doc, ref.id);
    return isComponent(node) ? nodeName(node) : null;
  }
  if (ref.kind === "skill" || ref.kind === "style") {
    return skillOf(ref.id, ref.kind === "skill" ? "design" : "style")?.title ?? null;
  }
  return scope.attachments?.find((item) => item.id === ref.id)?.name ?? null;
};

/**
 * A mention inside the agent's prompt text: readable and unambiguous, e.g.
 * `"Hero Section" [layer frame_12]` or `"Card", "Title" [layers a1, b2]`. Null when the
 * target is gone.
 */
export const mentionInlineLabel = (
  doc: PegoDocument,
  ref: MentionRef,
  scope: MentionScope = {},
): string | null => {
  if (ref.kind === "layer") {
    const nodes = ref.ids.flatMap((nodeId) => findNode(doc, nodeId) ?? []);
    if (nodes.length === 0) return null;
    const names = nodes.slice(0, 3).map((node) => `"${nodeName(node)}"`);
    if (nodes.length > 3) names.push(`+${nodes.length - 3} more`);
    const ids = nodes.slice(0, 3).map((node) => node.id);
    if (nodes.length > 3) ids.push("...");
    return `${names.join(", ")} [${nodes.length === 1 ? "layer" : "layers"} ${ids.join(", ")}]`;
  }
  const title = mentionTitle(doc, ref, scope);
  return title === null ? null : `"${title}" [${ref.kind} ${ref.id}]`;
};

/** Most layers listed in the context block; the rest are counted. */
export const MAX_LISTED = 30;

/**
 * The request context for mentions (and the canvas selection, given as a layer mention): which
 * layers, components and attachments the request is about, one line each, in the format
 * `- <id>: "<name>" (<type>)`. Skills and styles are not listed: they steer the run's skills.
 * Empty when nothing resolves.
 */
export const mentionContext = (
  doc: PegoDocument,
  mentions: readonly MentionRef[],
  scope: MentionScope = {},
): string => {
  const resolved = resolveMentions(doc, mentions, scope);
  const layerIds = [...new Set(resolved.flatMap((ref) => (ref.kind === "layer" ? ref.ids : [])))];
  const layers = layerIds.flatMap((nodeId) => findNode(doc, nodeId) ?? []);
  const components = resolved.flatMap((ref) =>
    ref.kind === "component" ? (findNode(doc, ref.id) ?? []) : [],
  );
  const attachments = resolved.flatMap((ref) =>
    ref.kind === "attachment"
      ? (scope.attachments?.filter((item) => item.id === ref.id) ?? [])
      : [],
  );

  const blocks: string[] = [];
  if (layers.length > 0) {
    const lines = layers
      .slice(0, MAX_LISTED)
      .map((node) => `- ${node.id}: "${nodeName(node)}" (${node.type})`);
    if (layers.length > MAX_LISTED) lines.push(`- ... and ${layers.length - MAX_LISTED} more`);
    blocks.push(
      [
        `The request is about ${layers.length === 1 ? "this layer" : `these ${layers.length} layers`}: edit ${layers.length === 1 ? "it (and its children)" : "them (and their children)"}, and leave other layers alone unless the request says otherwise.`,
        ...lines,
      ].join("\n"),
    );
  }
  if (components.length > 0) {
    blocks.push(
      [
        "Components the request refers to (reusable nodes; edit the component, or place instances of it):",
        ...components.map((node) => `- ${node.id}: "${nodeName(node)}" (${node.type}, component)`),
      ].join("\n"),
    );
  }
  if (attachments.length > 0) {
    blocks.push(
      [
        'Attached images the request refers to (use them with place_image, src "attachment:<id>"):',
        ...attachments.map((item) => `- ${item.id}: "${item.name}" (image)`),
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
};

/** The prompt the agent receives: the context block, then the user's words. */
export const withMentionContext = (prompt: string, context: string): string =>
  context ? `${context}\n\nRequest: ${prompt}` : prompt;

/**
 * The prompt's text for the agent: every mention token replaced by its inline label (a mention
 * whose target is gone becomes its plain title, or nothing).
 */
export const promptTextForAgent = (
  doc: PegoDocument,
  prompt: PromptWithMentions,
  scope: MentionScope = {},
): string =>
  prompt.text
    .replace(TOKEN_PATTERN, (_, index: string) => {
      const ref = prompt.mentions[Number(index)];
      return ref ? (mentionInlineLabel(doc, ref, scope) ?? "") : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();

/** One piece of a prompt as shown in the activity log: text, or a chip. */
export type PromptPart =
  { kind: "text"; text: string } | { kind: "mention"; mention: MentionKind; label: string };

/** The prompt split into text and chips for display (labels read from the document now). */
export const promptParts = (
  doc: PegoDocument,
  prompt: PromptWithMentions,
  scope: MentionScope = {},
): PromptPart[] => {
  const parts: PromptPart[] = [];
  let last = 0;
  for (const match of prompt.text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: prompt.text.slice(last, start) });
    const ref = prompt.mentions[Number(match[1])];
    const label = ref ? mentionTitle(doc, ref, scope) : null;
    if (ref && label !== null) parts.push({ kind: "mention", mention: ref.kind, label });
    last = start + match[0].length;
  }
  if (last < prompt.text.length) parts.push({ kind: "text", text: prompt.text.slice(last) });
  return parts;
};

/** Plain text of the parts (chips as "@Label"), for skill detection and copy/paste. */
export const promptPartsText = (parts: readonly PromptPart[]): string =>
  parts
    .map((part) => (part.kind === "text" ? part.text : `@${part.label}`))
    .join("")
    .trim();

/** The skill and style a prompt's mentions pick (the last of each wins), or undefined. */
export const mentionedSkills = (
  mentions: readonly MentionRef[],
): { skillId?: string; styleId?: string } => {
  let skillId: string | undefined;
  let styleId: string | undefined;
  for (const ref of mentions) {
    if (ref.kind === "skill" && skillOf(ref.id, "design")) skillId = ref.id;
    if (ref.kind === "style" && skillOf(ref.id, "style")) styleId = ref.id;
  }
  return { ...(skillId ? { skillId } : {}), ...(styleId ? { styleId } : {}) };
};
