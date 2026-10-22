import { SHIFT_TOOL_KEYS, TOOL_KEYS, type Tool } from "@/store/use-tool-store";

/** Key token: a modifier name (`mod`, `shift`, `alt`) or a literal key label ("Z", "Esc", "←"). */
export type KeyToken = string;
/** One chord, e.g. ["mod", "shift", "Z"]. */
export type Chord = readonly KeyToken[];

export type ShortcutEntry = {
  id: string;
  label: string;
  /** Alternative chords for the same action, e.g. Redo: Cmd+Shift+Z or Cmd+Y. */
  chords: readonly Chord[];
};

export type ShortcutGroup = {
  id: string;
  label: string;
  entries: readonly ShortcutEntry[];
};

const TOOL_LABELS: Record<Tool, string> = {
  select: "Select tool",
  hand: "Hand tool",
  frame: "Frame tool",
  rectangle: "Rectangle tool",
  ellipse: "Ellipse tool",
  text: "Text tool",
  pen: "Pen tool",
  pencil: "Pencil tool",
  line: "Line tool",
  arrow: "Arrow tool",
  polygon: "Polygon tool",
  star: "Star tool",
  image: "Place image",
};

const labelKey = (key: string) => key.toUpperCase();

/** Tool entries are generated from TOOL_KEYS / SHIFT_TOOL_KEYS so they cannot drift from the code. */
const toolEntries = (): ShortcutEntry[] => {
  const chordsByTool = new Map<Tool, Chord[]>();
  const add = (tool: Tool, chord: Chord) =>
    chordsByTool.set(tool, [...(chordsByTool.get(tool) ?? []), chord]);
  for (const [key, tool] of Object.entries(TOOL_KEYS)) add(tool, [labelKey(key)]);
  for (const [key, tool] of Object.entries(SHIFT_TOOL_KEYS)) add(tool, ["shift", labelKey(key)]);
  add("image", ["mod", "shift", "K"]);
  return [...chordsByTool].map(([tool, chords]) => ({
    id: `tool.${tool}`,
    label: TOOL_LABELS[tool],
    chords,
  }));
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { id: "tools", label: "Tools", entries: toolEntries() },
  {
    id: "edit",
    label: "Edit",
    entries: [
      { id: "edit.undo", label: "Undo", chords: [["mod", "Z"]] },
      {
        id: "edit.redo",
        label: "Redo",
        chords: [
          ["mod", "shift", "Z"],
          ["mod", "Y"],
        ],
      },
      { id: "edit.duplicate", label: "Duplicate", chords: [["mod", "D"]] },
      { id: "edit.duplicate-drag", label: "Duplicate while dragging", chords: [["alt", "Drag"]] },
      { id: "edit.delete", label: "Delete", chords: [["Delete"], ["Backspace"]] },
      { id: "edit.nudge", label: "Nudge selection", chords: [["←"], ["→"], ["↑"], ["↓"]] },
      {
        id: "edit.nudge-large",
        label: "Nudge by the large step",
        chords: [
          ["shift", "←"],
          ["shift", "→"],
          ["shift", "↑"],
          ["shift", "↓"],
        ],
      },
      { id: "edit.select-all", label: "Select all", chords: [["mod", "A"]] },
      { id: "edit.escape", label: "Back to Select, then step out of selection", chords: [["Esc"]] },
      { id: "edit.edit-text", label: "Edit selected text or path", chords: [["Enter"]] },
    ],
  },
  {
    id: "view",
    label: "View",
    entries: [
      { id: "view.zoom-in", label: "Zoom in", chords: [["+"], ["="]] },
      { id: "view.zoom-out", label: "Zoom out", chords: [["-"]] },
      {
        id: "view.zoom-100",
        label: "Zoom to 100%",
        chords: [
          ["shift", "0"],
          ["mod", "0"],
        ],
      },
      { id: "view.zoom-fit", label: "Zoom to fit", chords: [["shift", "1"]] },
      { id: "view.zoom-selection", label: "Zoom to selection", chords: [["shift", "2"]] },
      { id: "view.zoom-wheel", label: "Zoom at cursor", chords: [["mod", "Scroll"]] },
      { id: "view.pan", label: "Pan while held", chords: [["Space", "Drag"]] },
      {
        id: "view.pan-h",
        label: "Pan horizontally (Zoom wheel mode)",
        chords: [["shift", "Scroll"]],
      },
    ],
  },
  {
    id: "file",
    label: "File",
    entries: [
      { id: "file.open", label: "Open", chords: [["mod", "O"]] },
      { id: "file.save", label: "Save", chords: [["mod", "S"]] },
      { id: "file.save-as", label: "Save as", chords: [["mod", "shift", "S"]] },
    ],
  },
  {
    id: "panels",
    label: "Panels and app",
    entries: [
      { id: "panels.agent", label: "Agent panel", chords: [["alt", "1"]] },
      { id: "panels.layers", label: "Layers panel", chords: [["alt", "2"]] },
      { id: "app.settings", label: "Settings", chords: [["mod", ","]] },
    ],
  },
  {
    id: "drawing",
    label: "Drawing",
    entries: [
      {
        id: "draw.square",
        label: "Constrain to a square, or an axis while moving",
        chords: [["shift", "Drag"]],
      },
      { id: "draw.center", label: "Draw or resize from the center", chords: [["alt", "Drag"]] },
      {
        id: "draw.finish",
        label: "Finish pen path / exit path editing",
        chords: [["Enter"], ["Esc"]],
      },
      {
        id: "draw.undo-point",
        label: "Remove last pen point / delete anchor",
        chords: [["Backspace"], ["Delete"]],
      },
      { id: "draw.cancel", label: "Cancel pencil stroke or line", chords: [["Esc"]] },
    ],
  },
  {
    id: "text",
    label: "Text editing",
    entries: [{ id: "text.confirm", label: "Confirm text", chords: [["Esc"], ["mod", "Enter"]] }],
  },
  {
    id: "agent",
    label: "Agent decisions",
    entries: [
      { id: "agent.pick", label: "Pick option", chords: [["1"], ["2"], ["3"], ["4"]] },
      { id: "agent.navigate", label: "Move between options", chords: [["↑"], ["↓"]] },
      { id: "agent.custom", label: "Send a custom answer", chords: [["Enter"]] },
    ],
  },
];

const MODIFIERS = {
  mac: { mod: "⌘", shift: "⇧", alt: "⌥" },
  other: { mod: "Ctrl", shift: "Shift", alt: "Alt" },
} as const;

/** Display label for one key token on the given platform. */
export const formatKeyToken = (token: KeyToken, isMac: boolean): string => {
  const table: Record<string, string> = isMac ? MODIFIERS.mac : MODIFIERS.other;
  return table[token] ?? token;
};

/** Lowercase text used for search: label, group and every chord as displayed on both platforms. */
const searchText = (group: ShortcutGroup, entry: ShortcutEntry): string =>
  [
    group.label,
    entry.label,
    ...entry.chords.flatMap((c) => [
      c.map((t) => formatKeyToken(t, true)).join(" "),
      c.map((t) => formatKeyToken(t, false)).join(" "),
    ]),
  ]
    .join(" ")
    .toLowerCase();

/** Groups filtered by a free-text query (every word must match); empty groups are dropped. */
export const filterShortcuts = (
  query: string,
  groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS,
): ShortcutGroup[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        const text = searchText(group, entry);
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((group) => group.entries.length > 0);
};
