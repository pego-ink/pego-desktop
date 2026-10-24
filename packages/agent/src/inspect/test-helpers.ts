import {
  computeLayout,
  documentSchema,
  type Layout,
  type PegoDocument,
  type TextMeasurer,
} from "@pego/doc";
import { createFakeHost, type FakeHost } from "../test-host";
import type { ToolHost, ToolImage } from "../types";

/** Deterministic text metrics: glyph width 0.5em, line height 1.25em, wraps at maxWidth. */
export const measureText: TextMeasurer = (node, maxWidth, variables) => {
  const raw =
    typeof node.fontSize === "string" ? variables[node.fontSize.slice(1)]?.value : node.fontSize;
  const fontSize = typeof raw === "number" ? raw : 16;
  const length = node.content.length;
  if (maxWidth === undefined) return { width: length * fontSize * 0.5, height: fontSize * 1.25 };
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.5)));
  const lines = Math.max(1, Math.ceil(length / perLine));
  return { width: Math.min(length, perLine) * fontSize * 0.5, height: lines * fontSize * 1.25 };
};

export const makeDoc = (
  children: unknown[],
  variables: Record<string, unknown> = {},
): PegoDocument =>
  documentSchema.parse({
    version: 9,
    id: "doc",
    name: "Test",
    variables,
    children: [{ type: "page", id: "page-1", name: "Page 1", x: 0, y: 0, children }],
  });

export const layoutOf = (doc: PegoDocument): Layout => computeLayout(doc, measureText);

export const PNG: ToolImage = { mediaType: "image/png", data: "AAAA", width: 100, height: 50 };

export const ICONS = [
  "arrow-right",
  "arrow-left",
  "arrow-up-right",
  "circle-arrow-right",
  "calendar",
  "calendar-days",
  "calendar-check",
  "chevron-right",
  "search",
  "user",
  "users",
  "settings",
];

export type InspectHost = FakeHost & {
  selection: string[];
  viewport: string[][];
  renders: { nodeId: string; scale?: number; maxSize?: number }[];
};

/** Fake host with the optional editor capabilities. `without` removes capabilities. */
export const createInspectHost = (
  doc: PegoDocument,
  without: (keyof ToolHost)[] = [],
): InspectHost => {
  const base = createFakeHost(doc);
  const host: InspectHost = Object.assign(base, {
    selection: [] as string[],
    viewport: [] as string[][],
    renders: [] as InspectHost["renders"],
  });
  host.getLayout = () => layoutOf(base.getDoc());
  host.getSelection = () => host.selection;
  host.setSelection = (ids) => {
    host.selection = ids;
  };
  host.focusViewport = (ids) => void host.viewport.push(ids);
  host.listIcons = () => ICONS;
  host.renderImage = async (nodeId, options) => {
    host.renders.push({ nodeId, ...options });
    return PNG;
  };
  for (const key of without) delete (host as Partial<ToolHost>)[key];
  return host;
};
