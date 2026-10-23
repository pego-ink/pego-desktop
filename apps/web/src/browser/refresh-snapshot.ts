import { toast } from "sonner";
import { findNode, type ImageNode } from "@pego/doc";
import type { BrowserHost } from "@pego/agent";
import { activeRunCount } from "@/agent/run-registry";
import { useDocumentStore } from "@/store/use-document-store";
import { sharedBrowserHost } from "./browser-host";

type Source = NonNullable<ImageNode["source"]>;

/** Where a screenshot came from, as the browser host's target. */
export const sourceTarget = (source: Source) =>
  source.selector
    ? ({ kind: "query", selector: source.selector } as const)
    : ({ kind: "full-page" } as const);

/** The URL when it is http(s), else null (a shared file must not open `javascript:` or custom schemes). */
export const safeHttpUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

/** Load the screenshot's page (unless it is shown already) and capture its element again. */
export const captureSource = async (browser: BrowserHost, source: Source): Promise<string> => {
  if (browser.currentPage()?.url !== source.url) await browser.loadPage(source.url);
  const shot = await browser.screenshot(sourceTarget(source), { format: "webp", maxSide: 2560 });
  return shot.dataUrl;
};

/**
 * Refresh a screenshot from the live page in the in-app browser, in place (same layer, box and
 * name), as one undo step.
 */
export const refreshSnapshot = async (id: string): Promise<void> => {
  const node = findNode(useDocumentStore.getState().doc, id);
  if (node?.type !== "image" || !node.source) return;
  if (activeRunCount() > 0) {
    return void toast.error(
      "Wait for the agent run to finish: refreshing uses the shared browser.",
    );
  }
  if (!safeHttpUrl(node.source.url))
    return void toast.error("This screenshot's page is not a web address.");
  const browser = sharedBrowserHost();
  if (!browser) return void toast.error("Refreshing needs the in-app browser (desktop app).");
  try {
    const src = await captureSource(browser, node.source);
    const state = useDocumentStore.getState();
    if (state.commit([{ op: "update", id, props: { src } }], { label: "Refresh screenshot" })) {
      toast.success("Screenshot refreshed from the page");
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not refresh the screenshot");
  }
};

/** Show the screenshot's page in the browser panel. */
export const openSource = async (source: Source): Promise<void> => {
  const url = safeHttpUrl(source.url);
  if (!url) return void toast.error("This screenshot's page is not a web address.");
  const browser = sharedBrowserHost();
  if (!browser) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (activeRunCount() > 0) {
    return void toast.error("Wait for the agent run to finish: opening uses the shared browser.");
  }
  try {
    await browser.loadPage(url);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open the page");
  }
};
