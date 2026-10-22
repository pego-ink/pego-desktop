import type { Guide } from "./types";

export const overviewGuide: Guide = {
  id: "overview",
  title: "How to work in Pego",
  description:
    "The working loop (read, plan, build, screenshot, check, fix) and Pego's layout and sizing rules. Read this first.",
  content: `# How to work in Pego

## The loop
1. Read. get_selection when the user says "this" or "here"; get_document (rootId, maxDepth on big files) for existing ids, variables and components. Reuse what exists and match its style.
2. Decide the look. New design with no brand: list_styles then get_style, and pass its variables to set_variables. Existing design: reuse its variables. Read the guide for the kind of design (get_guidelines).
3. Plan. 3-8 steps, one section or one component per step.
4. Build one section at a time with batch_design. Name nodes with aliases so later operations in the same batch can refer to nodes created earlier. Build repeated UI (buttons, cards, rows, nav items) once with create_component, then place instances with create_instance and set_instance_overrides.
5. Place new top-level frames with find_empty_space, never by guessing coordinates.
6. Verify each section as soon as it exists: get_screenshot of the section, then check_layout on it. Fix with update_node (edit in place; do not delete and rebuild). Repeat until both are clean.
7. focus_nodes on the finished work so the user sees it, then summarize.

## Layout model
- frame is the container. layout is horizontal, vertical or none; gap and padding live on the frame; justifyContent and alignItems place children. Default to flex layouts; use layout none only for overlays and free artwork.
- Children of a flex frame ignore x and y. Offset a child by wrapping it in a frame with padding.
- Sizes: pixels, fill_container, fit_content. Frames hug their content by default. A parent that hugs cannot be sized by children that all fill it (circular): give the parent a width or let it fill its own parent.
- Text wraps when it has a width (number or fill_container); without a width it stays on one line. Never set a text height. Never guess text size.
- There are no margins or percentages. Spacing is gap and padding only.
- Only frame and group have children. Padding, layout and gap exist on frames only.
- Set clip: true on screen and card frames that hold images or rounded content.

## Structure
- Top level of the document holds only screens/pages, components, and major containers. Never put text, icons or buttons directly at the top level.
- Page frame: layout vertical, a fixed width (desktop 1440, tablet 834, mobile 390), height fit_content; sections are its children with width fill_container.
- Name every frame and section ("Hero", "Pricing Card"); names make find_nodes and later edits easy.
- Colors and spacing come from variables ($bg, $text, $accent, $radius-md, $space-md). Hex values appear only in set_variables.

## Quality bar
- One focal point per section; one primary action per screen.
- Vary section composition and density; do not stack identical card grids.
- Real, specific copy and plausible content for the product; never lorem ipsum or invented statistics presented as real.
- Icons come from search_icons names, used only where they carry meaning.
- After the last section, run check_layout on the whole document once more.`,
};
