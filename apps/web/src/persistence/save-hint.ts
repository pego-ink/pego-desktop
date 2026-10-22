/**
 * Subtitle for a document that has no file yet. The one-line title row next to the macOS traffic
 * lights has room for a word only; elsewhere it names the save shortcut in the platform's notation.
 */
export const untitledLabel = (compact: boolean, mac: boolean): string =>
  compact ? "Unsaved" : `Not saved to a file — ${mac ? "⌘S" : "Ctrl+S"} to save`;
