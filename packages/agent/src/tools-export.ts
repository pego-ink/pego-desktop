import { z } from "zod";
import { findLocation } from "@pego/doc";
import { exportCode } from "./export/code";
import { loadIcons } from "./export/icons";
import { exportSvg } from "./export/svg";
import type { ExportFile } from "./export/types";
import { defineTool, ok, ToolError } from "./tool-kit";
import type { ToolHost, ToolResult, ToolSpec } from "./types";

const id = z.string().min(1);
const MAX_TOTAL_CHARS = 30_000;
const MAX_SVG_CHARS = 40_000;
const MAX_SCALE = 3;
const MAX_IMAGE_SIZE = 2048;
const DATA_URL = /data:[^"')\s]{200,}/g;

const requireNode = (host: ToolHost, nodeId: string): void => {
  const location = findLocation(host.getDoc(), nodeId);
  if (!location) {
    throw new ToolError(
      "node_not_found",
      `node not found: ${nodeId}`,
      "Call get_document or find_nodes to see the current ids.",
    );
  }
  if (location.node.type === "page") {
    throw new ToolError(
      "invalid_node",
      `${nodeId} is a page, which cannot be exported`,
      "Export a frame or group on the page instead.",
    );
  }
};

/** Replace long embedded data URLs so one image cannot eat the whole result. */
export const stripDataUrls = (text: string): string =>
  text.replace(DATA_URL, (match) => `${match.slice(0, 40)}...[${match.length} chars omitted]`);

/** Cap the combined size of the files; later files are cut first. */
export const truncateFiles = (
  files: readonly ExportFile[],
  budget = MAX_TOTAL_CHARS,
): { files: ExportFile[]; truncated: boolean } => {
  let left = budget;
  let truncated = false;
  const out = files.map((file) => {
    const contents = stripDataUrls(file.contents);
    if (contents !== file.contents) truncated = true;
    if (contents.length <= left) {
      left -= contents.length;
      return { path: file.path, contents };
    }
    truncated = true;
    const kept = contents.slice(0, Math.max(0, left));
    left = 0;
    return { path: file.path, contents: `${kept}\n/* ...truncated */` };
  });
  return { files: out, truncated };
};

const exportCodeTool = defineTool({
  name: "export_code",
  description:
    "Generate front-end code for a node and its subtree. react-tailwind returns React + Tailwind v4 components (one file per component, plus styles.css with @theme tokens); html-css returns index.html + styles.css. " +
    "Frames with a layout become flexbox, variables become CSS custom properties, components become React components (text overrides become props), icons use lucide. " +
    "Long output and embedded image data are truncated with a note.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", minLength: 1, description: "Node to export (a frame or screen)." },
      format: { type: "string", enum: ["react-tailwind", "html-css"] },
    },
    required: ["nodeId", "format"],
    additionalProperties: false,
  },
  schema: z.strictObject({ nodeId: id, format: z.enum(["react-tailwind", "html-css"]) }),
  inputHint: '{ "nodeId": "<id>", "format": "react-tailwind" | "html-css" }',
  run: async ({ nodeId, format }, host) => {
    requireNode(host, nodeId);
    await loadIcons();
    const files = exportCode(host.getDoc(), nodeId, { format, layout: host.getLayout?.() });
    const result = truncateFiles(files);
    return ok({
      format,
      files: result.files,
      ...(result.truncated
        ? { note: "Output was truncated (long files or embedded image data were cut)." }
        : {}),
    });
  },
});

const exportImageTool = defineTool({
  name: "export_image",
  description:
    "Export a node as an image. png renders it as drawn on canvas (scale 1 to 3) and returns the image; svg returns the SVG markup as text (fonts referenced by family, wrapped text is approximated).",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", minLength: 1 },
      format: { type: "string", enum: ["png", "svg"] },
      scale: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: MAX_SCALE,
        description: "png only, default 1.",
      },
    },
    required: ["nodeId", "format"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    nodeId: id,
    format: z.enum(["png", "svg"]),
    scale: z.number().positive().max(MAX_SCALE).optional(),
  }),
  inputHint: '{ "nodeId": "<id>", "format": "png" | "svg", "scale"?: 1 | 2 | 3 }',
  run: async ({ nodeId, format, scale }, host): Promise<ToolResult> => {
    requireNode(host, nodeId);
    if (format === "png") {
      if (!host.renderImage) {
        throw new ToolError(
          "unsupported",
          "This editor connection cannot render images (renderImage is not available).",
        );
      }
      const image = await host.renderImage(nodeId, { scale: scale ?? 1, maxSize: MAX_IMAGE_SIZE });
      return {
        content: JSON.stringify({ format, width: image.width, height: image.height }),
        isError: false,
        images: [image],
      };
    }
    if (!host.getLayout) {
      throw new ToolError(
        "unsupported",
        "This editor connection cannot compute the layout (getLayout is not available).",
      );
    }
    await loadIcons();
    const svg = exportSvg(host.getDoc(), nodeId, { layout: host.getLayout() });
    const stripped = stripDataUrls(svg);
    const cut = stripped.length > MAX_SVG_CHARS;
    return ok({
      format,
      svg: cut ? `${stripped.slice(0, MAX_SVG_CHARS)}\n<!-- ...truncated -->` : stripped,
      ...(cut || stripped !== svg
        ? { note: "SVG was truncated (long markup or embedded image data)." }
        : {}),
    });
  },
});

/** Export tools: export_code, export_image. */
export const exportTools: ToolSpec[] = [exportCodeTool, exportImageTool];
