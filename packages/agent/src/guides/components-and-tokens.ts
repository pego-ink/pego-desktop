import type { Guide } from "./types";

export const componentsAndTokensGuide: Guide = {
  id: "components-and-tokens",
  title: "Components and tokens",
  description:
    "Variables as design tokens, reusable components, instances, overrides and when to detach.",
  content: `# Components and tokens

## Tokens first
Create variables before building, with set_variables (names without the $ there; written as $name in nodes).
- Colors: bg, surface, surface-2, border, text, text-muted, accent, on-accent, danger. Roles, not hues: "accent", never "blue".
- Numbers: radius-sm/md/lg, space-xs/sm/md/lg/xl.
- list_styles and get_style return a ready set with these names. Reuse the document's existing variables when it has some; do not overwrite them accidentally. Check with get_document before calling set_variables.
- Reference them everywhere: fill: "$surface", cornerRadius: "$radius-md", gap: "$space-md", text fill "$text". A hex in a node means a token is missing.
- Dark mode, rebrands and style swaps are then a single set_variables call.

## Components
- A component is a node with reusable: true, normally a frame. create_component makes one.
- Make a component when something appears two or more times: button, input, card, list row, nav item, tab, badge, table row.
- Give inner nodes stable, meaningful names and ids ("label", "icon", "title"): overrides are keyed by the id of the node inside the component.
- Components live at the top of the canvas (their own row) and are placed away from screens; use find_empty_space for the spot.
- Size components with fit_content or fill_container where they flex; put the fixed pixel sizes on the screen that uses them, not in the component.

## Instances
- create_instance places a ref node pointing at the component id. Set position or size on the instance when needed; layout parents place it automatically.
- set_instance_overrides changes props of nodes inside an instance, keyed by their component ids: {"label": {"content": "Buy now"}, "icon": {"iconName": "arrow-right"}}. Overridable: any prop except id, type and children. Typical overrides: content, fill, iconName.
- Instances follow later edits of the component. To restyle all buttons, edit the component once with update_node.
- Ids of nodes inside an instance (inst/label) cannot be edited directly; use set_instance_overrides or edit the component.
- detach_instance turns an instance into plain nodes when one copy must diverge structurally. Prefer a variant component (a second component) if several copies share the difference.

## Variants
Pego has no variant property. Model states as separate components ("Button / Primary", "Button / Secondary", "Tab / Selected") that share token names, and place the right one.

## Copying
copy_nodes duplicates a node or subtree (for sections you want to adapt); components are better when the copies should stay in sync.`,
};
