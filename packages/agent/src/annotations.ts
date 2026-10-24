/**
 * MCP tool annotations (https://modelcontextprotocol.io): hints clients use for display and
 * permission prompts. Pego tools only touch the open editor, except `browser` (websites) and
 * `search_images` (an image search service), which reach out to the web (open-world).
 */
export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  /** Only meaningful when not read-only: the tool can remove or overwrite existing content. */
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

type Kind = "read" | "add" | "change" | "destroy";

/** Tools that reach out to the web. */
const OPEN_WORLD = new Set(["browser", "search_images"]);

const TOOLS: Record<string, [title: string, kind: Kind]> = {
  get_document: ["Read document", "read"],
  get_node: ["Read node", "read"],
  get_selection: ["Read selection", "read"],
  find_nodes: ["Find nodes", "read"],
  get_screenshot: ["Screenshot node", "read"],
  check_layout: ["Check layout", "read"],
  find_empty_space: ["Find empty canvas space", "read"],
  search_icons: ["Search icons", "read"],
  get_guidelines: ["Read design guidelines", "read"],
  list_skills: ["List design skills", "read"],
  get_skill: ["Read design skill", "read"],
  export_code: ["Export node as code", "read"],
  export_image: ["Export node as image", "read"],
  list_styles: ["List style presets", "read"],
  get_style: ["Read style preset", "read"],
  insert_nodes: ["Insert nodes", "add"],
  create_component: ["Create component", "add"],
  create_instance: ["Create instance", "add"],
  copy_nodes: ["Copy nodes", "add"],
  connect_nodes: ["Connect nodes", "add"],
  insert_svg: ["Insert SVG", "add"],
  place_image: ["Place image", "add"],
  generate_image: ["Generate image", "add"],
  search_images: ["Search images", "read"],
  remove_background: ["Remove background", "change"],
  browser: ["Browser", "change"],
  update_node: ["Update node", "change"],
  move_node: ["Move node", "change"],
  set_variables: ["Set variables", "change"],
  set_instance_overrides: ["Set instance overrides", "change"],
  set_selection: ["Select nodes", "change"],
  focus_nodes: ["Focus nodes", "change"],
  create_page: ["Create page", "add"],
  go_to_page: ["Go to page", "change"],
  report_plan: ["Report plan", "change"],
  report_step: ["Report step", "change"],
  ask_user: ["Ask the user", "change"],
  replace_node: ["Replace node", "destroy"],
  delete_nodes: ["Delete nodes", "destroy"],
  detach_instance: ["Detach instance", "destroy"],
  apply_ops: ["Apply raw ops", "destroy"],
  batch_design: ["Batch design edits", "destroy"],
};

const IDEMPOTENT = new Set([
  "update_node",
  "move_node",
  "set_variables",
  "set_selection",
  "focus_nodes",
]);

/** Annotations for a tool; unknown tools get conservative defaults (may destroy). */
export const toolAnnotations = (name: string): ToolAnnotations => {
  const [title, kind] = TOOLS[name] ?? [name, "destroy"];
  return {
    title,
    readOnlyHint: kind === "read",
    destructiveHint: kind === "destroy",
    idempotentHint: kind === "read" || IDEMPOTENT.has(name),
    openWorldHint: OPEN_WORLD.has(name),
  };
};
