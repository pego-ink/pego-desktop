/**
 * Chrome DevTools Protocol methods the in-app browser accepts, one by one. The desktop app
 * enforces the same list: keep both in sync (`apps/desktop`). Navigation (`Page.navigate`),
 * network, fetch, target and browser-level methods are deliberately absent: pages load through
 * the `load-page` action, which only takes http(s) URLs.
 */
export const CDP_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Runtime.getProperties",
  "Runtime.releaseObject",
  "Page.captureScreenshot",
  "Page.getLayoutMetrics",
  "Page.getFrameTree",
  "Page.createIsolatedWorld",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOM.getOuterHTML",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.describeNode",
  "DOM.resolveNode",
  "DOM.requestNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.focus",
  "DOM.getAttributes",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Input.dispatchTouchEvent",
  "Input.dispatchDragEvent",
  "Emulation.setDeviceMetricsOverride",
  "Emulation.clearDeviceMetricsOverride",
  "Emulation.setEmulatedMedia",
  "Emulation.setScrollbarsHidden",
  "Emulation.setDefaultBackgroundColorOverride",
  "Emulation.setTouchEmulationEnabled",
  "CSS.enable",
  "CSS.getComputedStyleForNode",
  "CSS.getMatchedStylesForNode",
  "CSS.getInlineStylesForNode",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "Accessibility.queryAXTree",
]);

/** Group the allowlist by domain, e.g. `Runtime: evaluate, callFunctionOn, ...`. */
export const describeCdpAllowlist = (): string => {
  const byDomain = new Map<string, string[]>();
  for (const full of CDP_ALLOWED_METHODS) {
    const [domain = "", name = ""] = full.split(".");
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), name]);
  }
  return [...byDomain].map(([domain, names]) => `${domain}.{${names.join(",")}}`).join(" ");
};
