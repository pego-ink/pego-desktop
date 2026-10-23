import { importPen, pageOrFirst, type PegoDocument } from "@pego/doc";
import type { ProjectFile, ProjectInfo } from "@pego/agent";
import { requestProject } from "@/agent/bridge-client";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { contentBounds } from "@/interaction/camera";
import { parseDocumentFile } from "@/persistence/file-format";
import { CANVAS_BACKGROUND, type ResolvedTheme } from "@/theme/theme";

/** Thumbnail size in pixels (cards show it at half size for sharp HiDPI rendering). */
export const PREVIEW_WIDTH = 640;
export const PREVIEW_HEIGHT = 360;
const PREVIEW_PADDING = 24;

export type ProjectPreview = { image: string; file: string } | { image: null; file: string | null };

/** The file a project card shows: the most recently changed design. */
export const previewFile = (files: readonly ProjectFile[]): ProjectFile | null =>
  files.reduce<ProjectFile | null>(
    (latest, file) => (!latest || file.modifiedAt > latest.modifiedAt ? file : latest),
    null,
  );

/** Camera that fits `bounds` into the thumbnail, centered with padding. */
export const fitPreviewCamera = (
  bounds: { x: number; y: number; width: number; height: number },
  width = PREVIEW_WIDTH,
  height = PREVIEW_HEIGHT,
  padding = PREVIEW_PADDING,
): Camera => {
  const zoom = Math.min(
    (width - padding * 2) / Math.max(bounds.width, 1),
    (height - padding * 2) / Math.max(bounds.height, 1),
  );
  return {
    zoom,
    panX: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
};

const parse = (text: string, path: string): PegoDocument =>
  path.toLowerCase().endsWith(".pen")
    ? importPen(JSON.parse(text), "preview").doc
    : parseDocumentFile(text);

const bytesToDataUri = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
};

/** Render the first page of a document to a PNG data URI (null when the page is empty). */
const renderPreview = async (doc: PegoDocument, theme: ResolvedTheme): Promise<string | null> => {
  const [{ loadCanvasKit }, { renderDocument }, { loadDocumentFonts }] = await Promise.all([
    import("@/canvas/load-canvaskit"),
    import("@/canvas/render-document"),
    import("@/fonts/use-document-fonts"),
  ]);
  const res = await loadCanvasKit();
  await loadDocumentFonts(doc);
  const layout = getLayout(doc);
  const page = pageOrFirst(doc);
  const bounds = contentBounds(doc, layout, page.id);
  if (!bounds) return null;
  const surface = res.ck.MakeSurface(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  if (!surface) return null;
  try {
    renderDocument(res, surface.getCanvas(), doc, layout, fitPreviewCamera(bounds), {
      pageId: page.id,
      background: CANVAS_BACKGROUND[theme],
    });
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      const bytes = image.encodeToBytes();
      return bytes ? bytesToDataUri(bytes) : null;
    } finally {
      image.delete();
    }
  } finally {
    surface.delete();
  }
};

const cache = new Map<string, Promise<ProjectPreview>>();

/** Drop every cached preview of a project (it was deleted). */
export const forgetProjectPreviews = (projectId: string): void => {
  for (const key of cache.keys()) if (key.startsWith(`${projectId}:`)) cache.delete(key);
};
let queue: Promise<unknown> = Promise.resolve();

/**
 * Preview of a project's latest design. Cached per project change time and theme; renders run
 * one at a time so a dashboard full of projects does not spike WASM memory.
 */
export const getProjectPreview = (
  project: Pick<ProjectInfo, "id" | "dir" | "modifiedAt" | "fileCount"> & { mainFile?: string },
  theme: ResolvedTheme,
): Promise<ProjectPreview> => {
  const key = `${project.id}:${project.modifiedAt}:${theme}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const job = (async (): Promise<ProjectPreview> => {
    if (project.fileCount === 0) return { image: null, file: null };
    const listing = await requestProject("list", project.dir);
    const files = listing.files ?? [];
    // The project's design first; otherwise its most recently changed file.
    const file =
      files.find((candidate) => candidate.path === project.mainFile) ?? previewFile(files);
    if (!file) return { image: null, file: null };
    const read = await requestProject("read", file.path);
    const image = await renderPreview(parse(read.text ?? "", file.path), theme);
    return image ? { image, file: file.relativePath } : { image: null, file: file.relativePath };
  })();
  const run = queue.then(() => job);
  queue = run.catch(() => undefined);
  // Failed previews are retried on the next visit instead of staying cached.
  run.catch(() => cache.delete(key));
  cache.set(key, run);
  return run;
};
