/**
 * The editor's state as the agent sees it with every prompt sent from the composer: which document
 * and page are open, what is selected, the page's top-level layers (those in view first), the
 * document's components and the in-app browser. The agent can then answer "this", "the hero" or
 * "the page in the browser" without asking for it first. Built from plain data so every backend
 * gets the same block.
 */

export type AppStateLayer = {
  id: string;
  name: string;
  type: string;
  /** Top-level layers only: whether the layer is in the canvas viewport. */
  inView?: boolean;
};

export type AppStateBrowser = {
  url: string;
  title?: string;
  /** The element picked with the browser's picker. */
  picked?: { label: string; selector?: string } | null;
};

export type AppState = {
  document: { name: string; file: string | null; page: string };
  selection: readonly AppStateLayer[];
  /** Every top-level layer of the shown page; listed with those in view first. */
  topLevel: readonly AppStateLayer[];
  components: readonly AppStateLayer[];
  /** Null when the browser panel is closed (or not available, e.g. on the web). */
  browser: AppStateBrowser | null;
};

/** Most layers listed per line; the rest are counted. */
export const APP_STATE_LIMIT = 10;

const layerText = (layer: AppStateLayer) =>
  `\`${layer.id}\` (${layer.type}): "${layer.name}"${
    layer.inView === undefined ? "" : layer.inView ? " [in view]" : " [outside the view]"
  }`;

const listText = (layers: readonly AppStateLayer[], empty: string) => {
  if (layers.length === 0) return empty;
  const shown = layers.slice(0, APP_STATE_LIMIT).map(layerText);
  if (layers.length > APP_STATE_LIMIT) shown.push(`+${layers.length - APP_STATE_LIMIT} more`);
  return shown.join(", ");
};

/** The app state block that goes in front of the request. */
export const appStateContext = (state: AppState): string => {
  const { document: doc, browser } = state;
  const topLevel = [...state.topLevel].sort(
    (a, b) => Number(b.inView === true) - Number(a.inView === true),
  );
  const lines = [
    "Editor state when this message was sent (context only; the request says what to do):",
    `- Document: "${doc.name}" (${doc.file ? `file ${doc.file}` : "not saved to a file"}), page "${doc.page}"`,
    `- Selected layers: ${listText(state.selection, "none")}`,
    `- Top-level layers on the page: ${listText(topLevel, "none (the page is empty)")}`,
    `- Components: ${listText(state.components, "none")}`,
  ];
  if (browser) {
    const page = browser.url ? `open at ${browser.url}` : "open, no page loaded";
    const picked = browser.picked
      ? `; picked element: ${browser.picked.label}${
          browser.picked.selector ? ` (selector \`${browser.picked.selector}\`)` : ""
        }`
      : "";
    lines.push(`- In-app browser: ${page}${picked}`);
  }
  return lines.join("\n");
};
