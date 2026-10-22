import { z } from "zod";
import type { BrowserHost, BrowserTarget } from "./browser-types";
import { ImageSrcError, validateImageSrc } from "./media/image-src";
import { convertDomSnapshot } from "./media/dom";
import { defaultPosition, insertRaw } from "./tools-media";
import { defineTool, fail, ok, okText, ToolError } from "./tool-kit";
import type { ToolHost, ToolResult, ToolSpec } from "./types";

const MAX_TEXT = 40_000;
const MAX_WARNINGS = 20;
const CDP_DOMAINS = new Set([
  "DOM",
  "Input",
  "Page",
  "Runtime",
  "Emulation",
  "CSS",
  "Accessibility",
]);

const UNSUPPORTED_MESSAGE = "The in-app browser is only available in the Pego desktop app.";

const truncate = (text: string): string =>
  text.length <= MAX_TEXT
    ? text
    : `${text.slice(0, MAX_TEXT)}\n\n[truncated: ${text.length - MAX_TEXT} more characters. Use a narrower target (query a section) to see the rest.]`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Run a host call; a rejection becomes a `browser_error` tool error with the host's message. */
const viaHost = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw new ToolError(
      "browser_error",
      errorMessage(error),
      "Check the page is loaded (load-page) and the selector matches something visible.",
    );
  }
};

const toTarget = (
  target: "full-page" | "selection" | "query",
  selector: string | undefined,
): BrowserTarget => {
  if (target === "query") {
    if (!selector?.trim()) {
      throw new ToolError(
        "invalid_input",
        'querySelector is required when target is "query"',
        "Pass a CSS selector such as header, .pricing or #hero.",
      );
    }
    return { kind: "query", selector: selector.trim() };
  }
  return { kind: target };
};

const targetLabel = (target: BrowserTarget): string =>
  target.kind === "query" ? target.selector : target.kind === "selection" ? "selection" : "page";

const stripDataUrl = (dataUrl: string): string => {
  const comma = dataUrl.indexOf(",");
  return dataUrl.startsWith("data:") && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
};

/** Width and height from a base64 PNG header (IHDR), or null. */
const pngSize = (base64: string): { width: number; height: number } | null => {
  try {
    const bytes = Uint8Array.from(atob(base64.slice(0, 48)), (c) => c.charCodeAt(0));
    if (bytes.length < 24 || bytes[1] !== 0x50) return null;
    const view = new DataView(bytes.buffer);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  } catch {
    return null;
  }
};

const inputSchema = z.strictObject({
  action: z.enum([
    "load-page",
    "import-to-canvas",
    "screenshot-to-canvas",
    "return-element",
    "return-screenshot",
    "cdp",
  ]),
  target: z.enum(["full-page", "selection", "query"]).optional(),
  querySelector: z.string().max(1000).optional(),
  url: z.string().max(2048).optional(),
  method: z.string().max(200).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const requirePage = (browser: BrowserHost) => {
  const page = browser.currentPage();
  if (!page) {
    throw new ToolError(
      "no_page",
      "No page is loaded in the browser yet.",
      'Call browser with action "load-page" and a url first.',
    );
  }
  return page;
};

const browserTool = defineTool({
  name: "browser",
  description:
    "Interact with a real website loaded in the editor's built-in browser (desktop app): open a URL, reproduce a page (or one element) as editable canvas layers, screenshot it, or pull its DOM/screenshot back into the conversation. Call load-page first. " +
    "Actions: load-page {url} opens http(s) or file URLs; import-to-canvas rebuilds the target as ONE frame of editable Pego nodes (frames, text, images, vectors) beside the existing content, reporting node count and warnings; screenshot-to-canvas places a screenshot as a single image node; return-element returns the target's HTML and computed styles as text; return-screenshot shows you a screenshot of the target; cdp sends one DevTools Protocol command {method, params}. " +
    'target is "full-page" (default), "selection" (the element the user picked in the browser panel) or "query" (with querySelector, a CSS selector). Prefer query or selection over full-page: return-element on body/html can be huge, so query a section. ' +
    "Imported pages are normal Pego nodes: edit them like any design (update_node, batch_design). Layout is absolute (faithful positions, no flex reconstruction), unsupported CSS shows up in warnings. " +
    "CDP: only the DOM, Input, Page, Runtime, Emulation, CSS and Accessibility domains; check the effect of a command with return-screenshot.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "load-page",
          "import-to-canvas",
          "screenshot-to-canvas",
          "return-element",
          "return-screenshot",
          "cdp",
        ],
      },
      target: {
        type: "string",
        enum: ["full-page", "selection", "query"],
        description: 'What to work on. Default "full-page".',
      },
      querySelector: {
        type: "string",
        description: 'CSS selector, required when target is "query".',
      },
      url: { type: "string", description: "Page to open, required for load-page." },
      method: {
        type: "string",
        description: 'CDP method such as "Runtime.evaluate", required for cdp.',
      },
      params: { type: "object", description: "CDP parameters for cdp." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  schema: inputSchema,
  inputHint:
    'Pass {action: "load-page", url} first, then {action: "import-to-canvas" | "screenshot-to-canvas" | "return-element" | "return-screenshot", target?, querySelector?} or {action: "cdp", method, params?}.',
  run: async (input, host: ToolHost): Promise<ToolResult> => {
    const browser = host.browser;
    if (!browser) return fail("unsupported", UNSUPPORTED_MESSAGE);

    if (input.action === "load-page") {
      if (!input.url?.trim()) {
        throw new ToolError("invalid_input", "url is required for load-page", "Pass {url}.");
      }
      const page = await viaHost(() => browser.loadPage(input.url!.trim()));
      return ok({ ok: true, url: page.url, title: page.title });
    }

    if (input.action === "cdp") {
      const method = input.method?.trim();
      if (!method) {
        throw new ToolError(
          "invalid_input",
          "method is required for cdp",
          'Pass {method: "Runtime.evaluate", params: {...}}.',
        );
      }
      const domain = method.split(".")[0] ?? "";
      if (!method.includes(".") || !CDP_DOMAINS.has(domain)) {
        throw new ToolError(
          "cdp_not_allowed",
          `CDP method "${method}" is not allowed`,
          `Only the ${[...CDP_DOMAINS].join(", ")} domains are available.`,
        );
      }
      requirePage(browser);
      const result = await viaHost(() => browser.cdp(method, input.params));
      const data =
        typeof result === "object" && result !== null
          ? (result as { data?: unknown }).data
          : undefined;
      if (method === "Page.captureScreenshot" && typeof data === "string" && data.length > 0) {
        const size = pngSize(data) ?? { width: 0, height: 0 };
        return {
          content: "Screenshot captured.",
          isError: false,
          images: [{ mediaType: "image/png", data, ...size }],
        };
      }
      return okText(truncate(JSON.stringify(result ?? null) ?? "null"));
    }

    const page = requirePage(browser);
    const target = toTarget(input.target ?? "full-page", input.querySelector);

    switch (input.action) {
      case "return-element": {
        const text = await viaHost(() => browser.describeElement(target));
        return okText(truncate(text));
      }
      case "return-screenshot": {
        const shot = await viaHost(() =>
          browser.screenshot(target, { format: "png", maxSide: 1568 }),
        );
        return {
          content: `Screenshot of ${targetLabel(target)} (${shot.width}x${shot.height}).`,
          isError: false,
          images: [
            {
              mediaType: "image/png",
              data: stripDataUrl(shot.dataUrl),
              width: shot.width,
              height: shot.height,
            },
          ],
        };
      }
      case "screenshot-to-canvas": {
        const shot = await viaHost(() =>
          browser.screenshot(target, { format: "webp", maxSide: 2560 }),
        );
        let src: string;
        try {
          src = validateImageSrc(shot.dataUrl);
        } catch (error) {
          if (error instanceof ImageSrcError) {
            throw new ToolError("invalid_src", `The screenshot is not usable: ${error.message}`);
          }
          throw error;
        }
        const label = target.kind === "query" ? target.selector : page.title || page.url;
        const { node } = insertRaw(
          host,
          {
            type: "image",
            name: `Screenshot - ${label}`.slice(0, 200),
            src,
            fit: "fill",
            alt: `Screenshot of ${page.title || page.url}`.slice(0, 500),
            width: shot.width,
            height: shot.height,
            ...defaultPosition(host, null, undefined, undefined),
          },
          null,
        );
        return ok({
          ok: true,
          created: { id: node.id, type: node.type, name: node.name },
          width: shot.width,
          height: shot.height,
        });
      }
      case "import-to-canvas": {
        const snapshot = await viaHost(() => browser.snapshot(target));
        const converted = convertDomSnapshot(snapshot, { fullPage: target.kind === "full-page" });
        if (converted.count === 0) {
          throw new ToolError(
            "empty_import",
            "Nothing visible could be imported from that target.",
            "Try another selector, or use screenshot-to-canvas.",
          );
        }
        const { node, ignored } = insertRaw(
          host,
          { ...converted.node, ...defaultPosition(host, null, undefined, undefined) },
          null,
        );
        const warnings = [...converted.warnings, ...ignored.map((p) => `ignored property ${p}`)];
        return ok({
          ok: true,
          created: { id: node.id, type: node.type, name: node.name },
          width: "width" in node ? node.width : undefined,
          height: "height" in node ? node.height : undefined,
          nodeCount: converted.count,
          ...(warnings.length > 0
            ? {
                warnings: warnings.slice(0, MAX_WARNINGS),
                ...(warnings.length > MAX_WARNINGS
                  ? { warningsOmitted: warnings.length - MAX_WARNINGS }
                  : {}),
              }
            : {}),
        });
      }
    }
  },
});

/** The in-app browser tool (desktop only; `unsupported` elsewhere). */
export const browserTools: ToolSpec[] = [browserTool];
