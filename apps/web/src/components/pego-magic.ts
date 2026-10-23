/**
 * Pego Magic: one-click ideas for the selected layers, offered by the ✨ button next to the
 * selection. Each idea but Export HTML is an agent prompt about the selection; the agent makes
 * its result as a NEW copy beside the original and leaves the original as it is, so the user can
 * compare and keep what they like.
 */
export type MagicAction = {
  id: "layout" | "style" | "color" | "typography" | "surprise" | "export-html";
  label: string;
  /** What it does, for the tooltip. */
  hint: string;
};

export const MAGIC_ACTIONS: readonly MagicAction[] = [
  { id: "layout", label: "Layout variation", hint: "Same style, a fresh layout" },
  { id: "style", label: "Style variation", hint: "Same content, a new visual style" },
  { id: "color", label: "Color variation", hint: "Same design, a new palette" },
  { id: "typography", label: "Explore typography", hint: "New type pairing and scale" },
  { id: "surprise", label: "Surprise me", hint: "A bold take on the same idea" },
  { id: "export-html", label: "Export HTML", hint: "The selection as HTML and CSS" },
];

/** How every variation is delivered (shared by all prompt ideas). */
const DELIVERY =
  "Work on a copy: duplicate the selection with copy_nodes and place the copy beside the original (find_empty_space, to the right), name it after the original with a short suffix for this idea, then change only the copy. Never edit or move the original. Keep all of its real content (text, images, data), keep it working at the same size, and finish with check_layout on the copy.";

const PROMPTS: Record<Exclude<MagicAction["id"], "export-html">, string> = {
  layout:
    "Make a layout variation of the selected design. Keep its visual language: the same colors, fonts, variables and components. Rethink the structure instead: the grid, the order and grouping of sections, the hierarchy, alignment and spacing. Start from one strong reference that suits this product (a pattern from a well-made app or site of the same kind), take what makes it work, and keep the result simple and clean.",
  style:
    "Make a style variation of the selected design. Keep the content and the overall structure, and give it a clearly different visual style: pick a style preset that fits the product with list_styles and get_style (not the one it uses now) and apply it (surfaces, corners, borders, shadows, color and type). It should feel like a different brand direction for the same screen.",
  color:
    "Make a color variation of the selected design. Keep the layout, typography and content exactly; change only color. Choose a fresh palette that suits the product (background, surfaces, text, accent, states), keep contrast readable (WCAG AA for text), and apply it consistently. If the design uses color variables, set new values on the copy's own variables instead of hard-coding colors.",
  typography:
    "Explore typography on the selected design. Keep the layout, colors and content; change the type: a new font pairing for headings and body that suits the product, a clear type scale, weights, line heights and letter spacing. Make the hierarchy obvious at a glance and keep long text comfortable to read.",
  surprise:
    "Surprise me with a bold new take on the selected design. Keep its purpose and real content, but reinterpret everything else: an unexpected but fitting layout, style, color and typography, the kind of direction a great designer would pitch as the wild card. Make it polished, not random.",
};

/** The agent prompt of a prompt idea (Export HTML has none). */
export const magicPrompt = (id: Exclude<MagicAction["id"], "export-html">): string =>
  `${PROMPTS[id]}\n\n${DELIVERY}`;

/** What the chat shows for a magic run (the full prompt goes to the agent only). */
export const magicDisplay = (action: Pick<MagicAction, "label">): string =>
  `Pego Magic · ${action.label}`;
