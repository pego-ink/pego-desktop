import { toast } from "sonner";
import { domSnapshotToNode, type DomSnapshot, type ExtensionCapture } from "@pego/agent";
import { collectDocIds, createId, type Box, type PegoNode } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { primeFontResolver, resolveFont } from "@/fonts/resolve-font";
import { loadImageFromUrl } from "@/images/image-from-url";
import { contentBounds } from "@/interaction/camera";
import type { OpOutcome } from "@/persistence/bridge-documents";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { liveWorkspace } from "@/workspace/use-workspace-store";
import { normalizeImageDataUrl } from "./normalize-image";
import { inlineSnapshotImages } from "./snapshot-images";

/**
 * What the Pego browser extension sends (through the bridge's POST /extension/import): a page or
 * element as a DOM snapshot, turned into editable layers like the desktop browser's
 * import-to-canvas, or a screenshot of the visible tab. It lands beside what is already on the
 * shown page, selected and in view.
 */

/** Gap between the existing content and the import. */
const GAP = 120;

const fail = (content: string): OpOutcome => ({ content, isError: true });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the image"));
    reader.readAsDataURL(blob);
  });

/** Where an import of `size` goes on the shown page: right of its content, else at the origin. */
export const besideContent = (content: Box | null): { x: number; y: number } =>
  content
    ? { x: Math.round(content.x + content.width + GAP), y: Math.round(content.y) }
    : { x: 0, y: 0 };

/** Insert `node` beside the shown page's content, select it and bring it into view. */
const placeBeside = (node: PegoNode, label: string): boolean => {
  const state = useDocumentStore.getState();
  const page = activePage(state);
  const at = besideContent(contentBounds(state.doc, getLayout(state.doc), page.id));
  const placed = { ...node, ...at } as PegoNode;
  if (!state.commit([{ op: "insert", parentId: page.id, node: placed }], { label })) return false;
  useDocumentStore.getState().select([placed.id]);
  const after = useDocumentStore.getState();
  const box = getLayout(after.doc).get(placed.id);
  if (box) useViewportStore.getState().zoomToFit(box);
  return true;
};

const siteName = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
};

/** What the import needs besides the stores (replaced in tests). */
export type ImportDeps = {
  /** Loads the font catalog the converter matches page fonts against. */
  primeFonts?: () => Promise<unknown>;
};

const importSnapshot = async (
  capture: Extract<ExtensionCapture, { kind: "snapshot" }>,
  deps: ImportDeps,
): Promise<OpOutcome> => {
  await (deps.primeFonts ?? primeFontResolver)().catch(() => undefined);
  let snapshot: DomSnapshot;
  try {
    // Remote images are embedded (through the bridge when the site blocks CORS); elements the
    // desktop would rasterize with a screenshot are dropped, since the extension sent none.
    snapshot = await inlineSnapshotImages(capture.snapshot, {
      capture: () => Promise.reject(new Error("no element screenshots from the extension")),
      ensureVisible: async () => undefined,
      fetchImage: async (url) => blobToDataUrl(await loadImageFromUrl(url)),
      normalize: normalizeImageDataUrl,
    });
  } catch {
    return fail("The capture could not be read.");
  }
  let converted;
  try {
    converted = domSnapshotToNode(snapshot, collectDocIds(useDocumentStore.getState().doc), {
      fullPage: capture.fullPage,
      resolveFont,
    });
  } catch {
    return fail("The capture could not be turned into layers.");
  }
  if (!converted.node) return fail("Nothing visible could be imported from that page.");
  const title = capture.page.title.trim() || siteName(capture.page.url);
  const node = { ...converted.node, name: title.slice(0, 120) } as PegoNode;
  if (!placeBeside(node, `Import ${title}`)) return fail("The import could not be added.");
  toast.success(`Imported ${title}`, {
    description: `${converted.count} layers from ${siteName(capture.page.url)}`,
  });
  return {
    content: `Imported "${title}" as ${converted.count} layers${
      converted.warnings.length > 0 ? ` (${converted.warnings.length} warnings)` : ""
    }.`,
    isError: false,
  };
};

const importScreenshot = (
  capture: Extract<ExtensionCapture, { kind: "screenshot" }>,
): OpOutcome => {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(capture.dataUrl)) {
    return fail("The screenshot is not an image.");
  }
  const title = capture.page.title.trim() || siteName(capture.page.url);
  const node: PegoNode = {
    type: "image",
    id: createId(),
    name: `Screenshot · ${title}`.slice(0, 120),
    src: capture.dataUrl,
    fit: "fill",
    alt: `Screenshot of ${capture.page.url}`.slice(0, 500),
    source: { url: capture.page.url },
    x: 0,
    y: 0,
    width: Math.min(Math.round(capture.width), 10000),
    height: Math.min(Math.round(capture.height), 10000),
  };
  if (!placeBeside(node, `Screenshot of ${title}`))
    return fail("The screenshot could not be added.");
  toast.success(`Added a screenshot of ${title}`);
  return { content: `Added a screenshot of "${title}".`, isError: false };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `EDITOR_OPS.importCapture`: put a browser-extension capture on the shown page. */
export const importCaptureFromBridge = async (
  input: unknown,
  deps: ImportDeps = {},
): Promise<OpOutcome> => {
  if (!liveWorkspace()) return fail("Open a document in Pego first, then send the page again.");
  if (!isRecord(input) || !isRecord(input.page) || typeof input.page.url !== "string") {
    return fail("That is not a Pego capture.");
  }
  const capture = input as unknown as ExtensionCapture;
  if (capture.kind === "snapshot" && isRecord(input.snapshot)) return importSnapshot(capture, deps);
  if (capture.kind === "screenshot") return importScreenshot(capture);
  return fail("That is not a Pego capture.");
};
