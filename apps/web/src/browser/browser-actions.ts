import { toolByName } from "@pego/agent";
import type { BrowserTarget } from "@pego/agent";
import { toast } from "sonner";
import { createToolHost } from "@/agent/tool-host";

const MCP_LABELS = {
  "import-to-canvas": "Import from browser",
  "screenshot-to-canvas": "Screenshot from browser",
} as const;

/** The `browser` tool's input fields for a target. */
export const targetInput = (target: BrowserTarget) =>
  target.kind === "query"
    ? { target: "query" as const, querySelector: target.selector }
    : { target: target.kind };

/** A short toast line for the tool's JSON result (falls back to the raw first line). */
export const actionMessage = (
  action: keyof typeof MCP_LABELS,
  result: { content: string; isError: boolean },
): string => {
  const fallback = result.content.split("\n")[0] || (result.isError ? "Failed" : "Done");
  let data: unknown;
  try {
    data = JSON.parse(result.content);
  } catch {
    return fallback;
  }
  if (typeof data !== "object" || data === null) return fallback;
  const { error, nodeCount, warnings } = data as {
    error?: { message?: string };
    nodeCount?: number;
    warnings?: unknown[];
  };
  if (result.isError) return error?.message ?? fallback;
  if (action === "screenshot-to-canvas") return "Screenshot placed on the canvas";
  const layers = typeof nodeCount === "number" ? ` (${nodeCount} layers)` : "";
  const skipped = Array.isArray(warnings) && warnings.length ? `, ${warnings.length} skipped` : "";
  return `Imported to the canvas${layers}${skipped}`;
};

/** Runs the `browser` tool as a user action: one undo step, result toasted. */
const runBrowserAction = async (action: keyof typeof MCP_LABELS, target: BrowserTarget) => {
  const tool = toolByName("browser");
  if (!tool) return void toast.error("The browser tool is not available");
  const host = createToolHost({
    label: () => MCP_LABELS[action],
    countTransactions: false,
    focusFromOps: true,
  });
  if (!host.browser)
    return void toast.error("The in-app browser is only available in the desktop app");
  try {
    const result = await tool.run({ action, ...targetInput(target) }, host);
    const message = actionMessage(action, result);
    if (result.isError) toast.error(message);
    else toast.success(message);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

/** Convert the target's DOM into editable design layers. */
export const importToCanvas = (target: BrowserTarget): Promise<void> =>
  runBrowserAction("import-to-canvas", target);

/** Place a screenshot of the target on the canvas as an image. */
export const screenshotToCanvas = (target: BrowserTarget): Promise<void> =>
  runBrowserAction("screenshot-to-canvas", target);
