import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import type { PegoDocument } from "@pego/doc";
import { requestProject } from "@/agent/bridge-client";
import { downloadBlob } from "@/export/download";
import { codeFileName, exportBaseName } from "@/export/export-formats";
import { createZip, type ZipEntry } from "@/export/zip";
import { parseDocumentFile } from "@/persistence/file-format";

/** What Home can export a project as. */
export type ProjectExportKind = "pego" | "png" | "svg" | "html-css" | "react-tailwind";

export const PROJECT_EXPORTS: readonly { kind: ProjectExportKind; label: string }[] = [
  { kind: "pego", label: "Pego file (.pego)" },
  { kind: "png", label: "PNG @2x (.zip)" },
  { kind: "svg", label: "SVG (.zip)" },
  { kind: "html-css", label: "HTML / CSS (.zip)" },
  { kind: "react-tailwind", label: "React + Tailwind (.zip)" },
];

/** PNG exports render at retina size, like the Export section's default. */
const PNG_SCALE = 2;

/** One screen to export: a top-level frame (or instance) and its folder/file stem in the ZIP. */
export type ExportTarget = { id: string; folder: string; name: string };

/** `base`, or `base-2`, `base-3`... when it is taken (case-insensitive). */
const unique = (base: string, taken: Set<string>): string => {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`;
  taken.add(name.toLowerCase());
  return name;
};

/**
 * The screens of a project: every visible top-level frame or instance on every page, in order.
 * Library pages (read-only copies of another project's components) are left out. Each page is a
 * folder; names are kebab-case and made unique within it.
 */
export const exportTargets = (doc: PegoDocument): ExportTarget[] => {
  const folders = new Set<string>();
  return doc.children.flatMap((page) => {
    if (page.library) return [];
    const screens = page.children.filter(
      (node) => node.visible !== false && (node.type === "frame" || node.type === "ref"),
    );
    if (screens.length === 0) return [];
    const folder = unique(exportBaseName(page), folders);
    const names = new Set<string>();
    return screens.map((node) => ({
      id: node.id,
      folder,
      name: unique(exportBaseName(node), names),
    }));
  });
};

/** File-name stem of the project itself, e.g. `ayam-den-lapeh`. */
export const projectSlug = (project: Pick<ProjectInfo, "name">): string =>
  exportBaseName({ name: project.name, type: "project" });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The project's design file as text, read through the bridge. */
const readDesignText = async (project: ProjectInfo): Promise<string> => {
  const { text } = await requestProject("read", project.mainFile);
  if (text === undefined || text === null) throw new Error("the project has no design yet");
  return text;
};

/** The ZIP entries of one screen in `kind`. */
const entriesFor = async (
  doc: PegoDocument,
  target: ExportTarget,
  kind: Exclude<ProjectExportKind, "pego">,
): Promise<ZipEntry[]> => {
  const generate = await import("@/export/generate");
  const base = `${target.folder}/${target.name}`;
  if (kind === "png") {
    const { blob } = await generate.generatePng(doc, target.id, PNG_SCALE);
    return [{ path: `${base}@${PNG_SCALE}x.png`, data: new Uint8Array(await blob.arrayBuffer()) }];
  }
  const encoder = new TextEncoder();
  if (kind === "svg") {
    return [
      { path: `${base}.svg`, data: encoder.encode(await generate.generateSvg(doc, target.id)) },
    ];
  }
  const files = await generate.generateCode(doc, target.id, kind);
  return files.map((file) => ({
    path: `${base}/${codeFileName(file.path)}`,
    data: encoder.encode(file.contents),
  }));
};

/**
 * Home › a project's menu › Export: download its design file, or every screen as PNG, SVG or code
 * in one ZIP (a folder per page). Screens that fail are skipped and named in the toast.
 */
export const exportProject = async (
  project: ProjectInfo,
  kind: ProjectExportKind,
): Promise<void> => {
  const slug = projectSlug(project);
  const label = PROJECT_EXPORTS.find((entry) => entry.kind === kind)?.label ?? kind;
  const progress = toast.loading(`Exporting ${project.name}…`);
  try {
    const text = await readDesignText(project);
    if (kind === "pego") {
      downloadBlob(new Blob([text], { type: "application/json" }), `${slug}.pego`);
      toast.success(`Exported ${project.name}`, { id: progress, description: `${slug}.pego` });
      return;
    }
    const doc = parseDocumentFile(text);
    const targets = exportTargets(doc);
    if (targets.length === 0) {
      toast.info(`${project.name} has no frames to export`, { id: progress });
      return;
    }
    const entries: ZipEntry[] = [];
    const failed: string[] = [];
    for (const [index, target] of targets.entries()) {
      toast.loading(`Exporting ${project.name}… ${index + 1}/${targets.length}`, { id: progress });
      try {
        entries.push(...(await entriesFor(doc, target, kind)));
      } catch {
        failed.push(`${target.folder}/${target.name}`);
      }
    }
    if (entries.length === 0) throw new Error("no frame could be exported");
    const zipName = `${slug}-${kind}.zip`;
    downloadBlob(new Blob([createZip(entries)], { type: "application/zip" }), zipName);
    toast.success(`Exported ${targets.length - failed.length} frames as ${label}`, {
      id: progress,
      description: failed.length > 0 ? `Skipped: ${failed.join(", ")}` : zipName,
    });
  } catch (error) {
    toast.error(`Could not export ${project.name}: ${errorMessage(error)}`, { id: progress });
  }
};
