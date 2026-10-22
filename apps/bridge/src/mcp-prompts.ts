import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";

const KINDS = ["web-app", "mobile-app", "landing-page", "dashboard"] as const;
type Kind = (typeof KINDS)[number];

const isKind = (value: unknown): value is Kind => KINDS.some((kind) => kind === value);

export const MAX_PROMPT_BRIEF_CHARS = 4000;

export const pegoPrompts: Prompt[] = [
  {
    name: "design_screen",
    title: "Design a screen",
    description:
      "Design a complete screen in Pego from a short brief, following the Pego design skills.",
    arguments: [
      {
        name: "kind",
        description: `One of: ${KINDS.join(", ")}`,
        required: true,
      },
      {
        name: "brief",
        description: "What the screen is for and what it must contain",
        required: true,
      },
    ],
  },
  {
    name: "polish_selection",
    title: "Polish the selection",
    description: "Inspect the current selection, check its layout, look at it and fix problems.",
  },
  {
    name: "extract_components",
    title: "Extract components",
    description: "Find repeated UI in the document and turn it into reusable components.",
  },
];

const user = (text: string): GetPromptResult["messages"][number] => ({
  role: "user",
  content: { type: "text", text },
});

const designScreen = (kind: Kind, brief: string): string =>
  `Design a ${kind} screen in Pego.

Brief: ${brief}

Work in this order:
1. Call get_skill for "core" (it applies to every design) and for "${kind}", and follow their rules. Note their checklists.
2. Call list_styles, pick the style that fits the brief, then call get_style for its tokens. Apply them as variables, not hard-coded values.
3. Call find_empty_space to choose a spot on the canvas that overlaps nothing, then build the screen with batch_design: one frame per screen, auto-layout everywhere, real copy instead of lorem ipsum.
4. When a part repeats (cards, list rows, nav items), call create_component once and create_instance for each use.
5. Call get_screenshot of the finished frame, then check_layout. Fix every problem you find with batch_design and look again until it is clean, then go through the skills' checklists and fix what fails.
6. Call focus_nodes on the result so the user sees it.`;

const POLISH = `Polish the user's current selection in Pego.

1. Call get_selection to see what is selected. If nothing is selected, say so and stop.
2. Call get_skill for "core" and for the skill that matches the selected design (list_skills shows them).
3. Call check_layout on the selection and note every overflow, overlap, misalignment and inconsistent spacing.
4. Call get_screenshot of the selection and judge hierarchy, contrast, spacing rhythm and alignment by eye.
5. Fix what you found with batch_design, touching only the selection and its children. Keep the existing style and variables.
6. Call check_layout and get_screenshot again to confirm, repeat if needed, then call focus_nodes on the selection.
Report briefly what you changed.`;

const EXTRACT = `Find repeated UI in the open Pego document and turn it into components.

1. Call get_skill for "core" and, if it exists, "design-system" (list_skills shows what is available).
2. Read the document structure and look for subtrees that repeat with the same shape (cards, list rows, buttons, nav items, form fields), including near-duplicates that differ only in text, image or color.
3. For each repeated pattern, call create_component from the best instance, then replace the other occurrences with create_instance, overriding only what differs (text, images, fills).
4. Do not change how anything looks. Call get_screenshot and check_layout before and after to confirm nothing moved.
5. Call focus_nodes on the first new component and summarise which components you made and how many instances each replaced.`;

/** Resolve a prompt by name; returns `undefined` for an unknown prompt, throws on bad arguments. */
export const getPegoPrompt = (
  name: string,
  args: Record<string, string> | undefined,
): GetPromptResult | undefined => {
  if (name === "design_screen") {
    const kind = args?.kind;
    const brief = args?.brief?.trim();
    if (!isKind(kind)) throw new Error(`"kind" must be one of: ${KINDS.join(", ")}`);
    if (!brief) throw new Error('"brief" is required');
    if (brief.length > MAX_PROMPT_BRIEF_CHARS) {
      throw new Error(`"brief" is too long (max ${MAX_PROMPT_BRIEF_CHARS} characters)`);
    }
    return { description: `Design a ${kind} screen`, messages: [user(designScreen(kind, brief))] };
  }
  if (name === "polish_selection") {
    return { description: "Polish the selection", messages: [user(POLISH)] };
  }
  if (name === "extract_components") {
    return { description: "Extract components", messages: [user(EXTRACT)] };
  }
  return undefined;
};
