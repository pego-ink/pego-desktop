import { z } from "zod";
import { findLocation, type Layout, type PegoDocument } from "@pego/doc";
import { checkLayout } from "./inspect/check-layout";
import { findEmptySpace } from "./inspect/empty-space";
import { findNodes, searchIcons } from "./inspect/search";
import { serializeDocument } from "./serialize";
import { coreSkill, findSkill, skills, type Skill } from "./skills/index";
import { findStyle, stylePresets } from "./styles/index";
import { defineTool, ok, ToolError } from "./tool-kit";
import type { ToolHost, ToolResult, ToolSpec } from "./types";

const id = z.string().min(1);
const idList = z.array(id).min(1).max(200);
const MAX_SCALE = 2;
const DEFAULT_MAX_SIZE = 1600;

const unsupported = (capability: string, what: string): ToolError =>
  new ToolError(
    "unsupported",
    `This editor connection cannot ${what} (${capability} is not available).`,
    "Continue without it: use get_document to inspect the document instead.",
  );

const requireLayout = (host: ToolHost): Layout => {
  if (!host.getLayout) throw unsupported("getLayout", "compute the layout");
  return host.getLayout();
};

const requireIds = (doc: PegoDocument, ids: string[]): void => {
  const missing = ids.filter((nodeId) => !findLocation(doc, nodeId));
  if (missing.length > 0) {
    throw new ToolError(
      "node_not_found",
      `node(s) not found: ${missing.join(", ")}`,
      "Call get_document or find_nodes to see the current ids.",
    );
  }
};

const idsSchema = (description: string) => ({
  type: "array",
  items: { type: "string", minLength: 1 },
  minItems: 1,
  maxItems: 200,
  description,
});

const round = (value: number): number => Math.round(value);

// --- eyes ----------------------------------------------------------------------

const getScreenshot = defineTool({
  name: "get_screenshot",
  description:
    "Render one node (and its subtree) to a PNG exactly as drawn on the canvas, so you can look at it. " +
    "Use it to verify visual results after building a section: spacing, hierarchy, contrast, clipped or misaligned content. " +
    "Screenshot a section or a screen, not the whole document, to keep text legible. Pair it with check_layout.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", minLength: 1, description: "Node to render." },
      scale: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: MAX_SCALE,
        description: "Pixel scale, default 1, max 2.",
      },
      maxSize: {
        type: "integer",
        minimum: 64,
        description: "Longest side in pixels, default 1600. The image is scaled down to fit.",
      },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    nodeId: id,
    scale: z.number().positive().max(MAX_SCALE).optional(),
    maxSize: z.number().int().min(64).max(4096).optional(),
  }),
  inputHint: "Pass {nodeId: string, scale?: number (max 2), maxSize?: integer}.",
  run: async (input, host): Promise<ToolResult> => {
    if (!host.renderImage) throw unsupported("renderImage", "render screenshots");
    const node = findLocation(host.getDoc(), input.nodeId)?.node;
    if (!node) {
      throw new ToolError(
        "node_not_found",
        `node "${input.nodeId}" not found`,
        "Call get_document or find_nodes to see the current ids.",
      );
    }
    const image = await host.renderImage(input.nodeId, {
      scale: input.scale ?? 1,
      maxSize: input.maxSize ?? DEFAULT_MAX_SIZE,
    });
    return {
      content: JSON.stringify({
        nodeId: node.id,
        name: node.name ?? node.type,
        type: node.type,
        width: image.width,
        height: image.height,
      }),
      isError: false,
      images: [image],
    };
  },
});

const checkLayoutTool = defineTool({
  name: "check_layout",
  description:
    "Analyze the document layout for problems and return a compact list of issues {severity, nodeId, name, issue, hint}, errors first, at most 50, plus a one-line summary. " +
    "Detects: children overflowing their parent (and whether it clips), text that needs more height than its fixed height, zero-size nodes, partially overlapping siblings in layout none frames, x/y set on flex children (ignored), text contrast below WCAG AA against the nearest ancestor fill, fill_container inside a parent that hugs on the same axis, and empty frames. " +
    "Run it after building each section (pass the section's nodeId) and once on the whole document at the end. Fix issues with update_node and run it again.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        minLength: 1,
        description: "Check only this node and its subtree. Omit for the whole document.",
      },
    },
    additionalProperties: false,
  },
  schema: z.strictObject({ nodeId: id.optional() }),
  inputHint: "Optional {nodeId?: string}.",
  run: (input, host) => {
    const layout = requireLayout(host);
    const doc = host.getDoc();
    if (input.nodeId) requireIds(doc, [input.nodeId]);
    return ok(checkLayout(doc, layout, input.nodeId));
  },
});

const findEmptySpaceTool = defineTool({
  name: "find_empty_space",
  description:
    "Find x/y for a new top-level frame of the given size that overlaps no existing top-level node and keeps padding around it. " +
    "Use it for every new screen or component row; pass nearNodeId and a direction to place it beside a related frame (for example the next screen in a flow). " +
    "Returns {x, y, width, height}: use x and y when inserting the frame.",
  inputSchema: {
    type: "object",
    properties: {
      width: { type: "number", exclusiveMinimum: 0 },
      height: { type: "number", exclusiveMinimum: 0 },
      nearNodeId: { type: "string", minLength: 1, description: "Place next to this node." },
      direction: {
        type: "string",
        enum: ["right", "below", "left", "above"],
        description: "Which side of the anchor to try first. Default right.",
      },
      padding: { type: "number", minimum: 0, description: "Gap to keep around, default 80." },
    },
    required: ["width", "height"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
    nearNodeId: id.optional(),
    direction: z.enum(["right", "below", "left", "above"]).optional(),
    padding: z.number().nonnegative().optional(),
  }),
  inputHint: "Pass {width, height, nearNodeId?, direction?: right|below|left|above, padding?}.",
  run: (input, host) => {
    const layout = requireLayout(host);
    const doc = host.getDoc();
    if (input.nearNodeId) requireIds(doc, [input.nearNodeId]);
    const placement = findEmptySpace(doc, layout, input);
    return ok({
      x: round(placement.x),
      y: round(placement.y),
      width: placement.width,
      height: placement.height,
      direction: placement.direction,
      anchor: placement.anchor,
    });
  },
});

// --- finding ---------------------------------------------------------------------

const findNodesTool = defineTool({
  name: "find_nodes",
  description:
    "Search the document for nodes. Filters combine (all must match): query (free text over name, text content, id, icon name and type), type, name (substring), text (substring of a text node's content), withinId (limit to a subtree). " +
    "Returns id, type, name, parentId, box (absolute x/y/width/height when the layout is available) and a text snippet. Use it instead of reading a big document to find where something is.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      type: {
        type: "string",
        enum: ["frame", "group", "rectangle", "ellipse", "path", "text", "icon", "ref"],
      },
      name: { type: "string" },
      text: { type: "string" },
      withinId: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 25." },
    },
    additionalProperties: false,
  },
  schema: z.strictObject({
    query: z.string().min(1).optional(),
    type: z
      .enum(["frame", "group", "rectangle", "ellipse", "path", "text", "icon", "ref"])
      .optional(),
    name: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    withinId: id.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputHint: "All fields optional: {query?, type?, name?, text?, withinId?, limit?}.",
  run: (input, host) => {
    const doc = host.getDoc();
    if (input.withinId) requireIds(doc, [input.withinId]);
    const { matches, total } = findNodes(doc, host.getLayout?.(), {
      ...input,
      limit: input.limit ?? 25,
    });
    return ok({ total, shown: matches.length, matches });
  },
});

// --- selection and viewport -------------------------------------------------------

const getSelectionTool = defineTool({
  name: "get_selection",
  description:
    "The nodes the user has selected in the editor, each with a short serialization (its line and its direct children). " +
    'Call it first whenever the user says "this", "here", "these" or "fix it" without naming a node.',
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  schema: z.strictObject({}),
  inputHint: "No input.",
  run: (_input, host) => {
    if (!host.getSelection) throw unsupported("getSelection", "read the selection");
    const doc = host.getDoc();
    const selected = host.getSelection();
    const present = selected.filter((nodeId) => findLocation(doc, nodeId));
    const layout = host.getLayout?.();
    const nodes = present.map((nodeId) => {
      const text = serializeDocument(doc, { rootId: nodeId, maxDepth: 1 });
      const tree = text.slice(text.indexOf("\ntree:\n") + "\ntree:\n".length);
      const box = layout?.get(nodeId);
      return {
        id: nodeId,
        ...(box
          ? {
              box: {
                x: round(box.x),
                y: round(box.y),
                width: round(box.width),
                height: round(box.height),
              },
            }
          : {}),
        node: tree,
      };
    });
    return ok({
      count: nodes.length,
      ...(nodes.length === 0
        ? { note: "Nothing is selected. Ask the user or use find_nodes." }
        : {}),
      selection: nodes,
    });
  },
});

const setSelectionTool = defineTool({
  name: "set_selection",
  description:
    "Select nodes in the editor (replaces the current selection). An empty list clears it. Use it to show the user what you mean or to set up a follow-up 'this'.",
  inputSchema: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 200 } },
    required: ["ids"],
    additionalProperties: false,
  },
  schema: z.strictObject({ ids: z.array(id).max(200) }),
  inputHint: "Pass {ids: string[]}.",
  run: (input, host) => {
    if (!host.setSelection) throw unsupported("setSelection", "change the selection");
    requireIds(host.getDoc(), input.ids);
    host.setSelection(input.ids);
    return ok({ selected: input.ids });
  },
});

const focusNodesTool = defineTool({
  name: "focus_nodes",
  description:
    "Pan and zoom the user's viewport so these nodes are visible. Use it when a section is finished so the user sees the result. Set select to true to select them as well.",
  inputSchema: {
    type: "object",
    properties: {
      ids: idsSchema("Nodes to bring into view."),
      select: { type: "boolean", description: "Also select them. Default false." },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  schema: z.strictObject({ ids: idList, select: z.boolean().optional() }),
  inputHint: "Pass {ids: string[], select?: boolean}.",
  run: (input, host) => {
    if (!host.focusViewport) throw unsupported("focusViewport", "move the viewport");
    requireIds(host.getDoc(), input.ids);
    host.focusViewport(input.ids);
    const selected = input.select === true && host.setSelection !== undefined;
    if (selected) host.setSelection?.(input.ids);
    return ok({ focused: input.ids, selected });
  },
});

// --- icons ------------------------------------------------------------------------

const searchIconsTool = defineTool({
  name: "search_icons",
  description:
    "Find icon names for icon nodes (lucide, kebab-case, e.g. arrow-right). Fuzzy: prefix and whole-word matches rank first. Returns names only; pass one as iconName. Search before using an icon so you never use a name that does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, description: 'e.g. "calendar", "arrow right".' },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputHint: "Pass {query: string, limit?: integer}.",
  run: (input, host) => {
    if (!host.listIcons) throw unsupported("listIcons", "list icons");
    const icons = searchIcons(host.listIcons(), input.query, input.limit ?? 20);
    return ok({
      query: input.query,
      icons,
      ...(icons.length === 0 ? { note: "No match. Try a simpler or related word." } : {}),
    });
  },
});

// --- skills and styles -------------------------------------------------------------

const skillIds = (): string => skills.map((skill) => skill.id).join(", ") || "none yet";

const skillSummary = (skill: Skill) => ({
  id: skill.id,
  title: skill.title,
  description: skill.description,
  styles: skill.styles,
  ...(skill.core ? { core: true } : {}),
});

const skillDetail = (skill: Skill) => ({
  ...skillSummary(skill),
  content: skill.content,
  checklist: skill.checklist,
});

const unknownSkill = (what: string, name: string): ToolError =>
  new ToolError(
    what,
    `no skill named "${name}"`,
    `Available: ${skillIds()}. Call list_skills to see them.`,
  );

const listSkills = defineTool({
  name: "list_skills",
  description:
    "List the Pego design skills (id, title, description, suggested style ids). The core skill applies to every design; pick the skill that matches the kind of design, then call get_skill for it before building.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  schema: z.strictObject({}),
  inputHint: "No input.",
  run: () => ok({ skills: skills.map(skillSummary) }),
});

const getSkill = defineTool({
  name: "get_skill",
  description:
    "Get one design skill: its full guidance, the checklist to verify before reporting done, and suggested style ids. " +
    `Skills: ${skillIds()}. ` +
    "The core skill applies to every design: read it once per task, plus the skill for the kind of design, before building.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", minLength: 1, description: "Skill id from list_skills." } },
    required: ["id"],
    additionalProperties: false,
  },
  schema: z.strictObject({ id: z.string().min(1) }),
  inputHint: "Pass {id: string}, a skill id from list_skills.",
  run: (input) => {
    const skill = findSkill(input.id);
    if (!skill) throw unknownSkill("unknown_skill", input.id);
    return ok(skillDetail(skill));
  },
});

/** Topics of the retired guides mapped to the skill that now covers them. */
const LEGACY_TOPICS: Record<string, string> = {
  overview: "core",
  "typography-and-color": "core",
  "components-and-tokens": "design-system",
};

const resolveLegacyTopic = (topic: string): Skill | undefined => {
  const key = topic.trim().toLowerCase();
  if (key === "core" || key === "overview" || key === "typography-and-color") {
    return coreSkill() ?? findSkill(LEGACY_TOPICS[key] ?? key);
  }
  return findSkill(LEGACY_TOPICS[key] ?? key);
};

const getGuidelines = defineTool({
  name: "get_guidelines",
  description:
    "Deprecated alias of the skills: without topic it lists the skills (same as list_skills); with a topic (a skill id; overview means core) it returns that skill (same as get_skill). Prefer list_skills and get_skill.",
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", description: "Skill id, or the legacy topic name." } },
    additionalProperties: false,
  },
  schema: z.strictObject({ topic: z.string().min(1).optional() }),
  inputHint: "Optional {topic}: a skill id. Prefer get_skill.",
  run: (input) => {
    if (input.topic === undefined) return ok({ skills: skills.map(skillSummary) });
    const skill = resolveLegacyTopic(input.topic);
    if (!skill) throw unknownSkill("unknown_topic", input.topic);
    return ok(skillDetail(skill));
  },
});

const listStyles = defineTool({
  name: "list_styles",
  description:
    "List the style presets (name, mood, best use, fonts). Pick one when the user has no brand or style, then call get_style for its variables. Skip this when the document already has variables and a look to match.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  schema: z.strictObject({}),
  inputHint: "No input.",
  run: () =>
    ok({
      styles: stylePresets.map((style) => ({
        name: style.name,
        title: style.title,
        mood: style.mood,
        bestFor: style.bestFor,
        fonts: style.fonts,
      })),
    }),
});

const getStyle = defineTool({
  name: "get_style",
  description:
    "Full style preset: fonts (Google Fonts), type scale, stroke and elevation rules, do/don't notes, and `variables` ready to pass to set_variables (color roles and radius/spacing numbers). " +
    "Create the variables first, then build with $tokens, not hex values.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: stylePresets.map((style) => style.name),
        description: "Style name.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  schema: z.strictObject({ name: z.string().min(1) }),
  inputHint: `Pass {name}: one of ${stylePresets.map((s) => s.name).join(", ")}.`,
  run: (input) => {
    const style = findStyle(input.name);
    if (!style) {
      throw new ToolError(
        "unknown_style",
        `no style named "${input.name}"`,
        `Call list_styles. Available: ${stylePresets.map((s) => s.name).join(", ")}.`,
      );
    }
    return ok(style);
  },
});

/** Eyes and context: screenshots, layout checks, search, selection, viewport, icons, skills, styles. */
export const inspectTools: ToolSpec[] = [
  getScreenshot,
  checkLayoutTool,
  findEmptySpaceTool,
  findNodesTool,
  getSelectionTool,
  setSelectionTool,
  focusNodesTool,
  searchIconsTool,
  listSkills,
  getSkill,
  getGuidelines,
  listStyles,
  getStyle,
];
