import { describe, expect, test } from "bun:test";
import { isSafeUrl, safeHtmlPlugin, type SafeHtmlContext } from "@/lib/safe-markdown";

type Node = Parameters<SafeHtmlContext["removeNode"]>[0];

/** Runs the plugin on a flat list of hast nodes and returns the tree it leaves. */
const run = (nodes: Node[]): Node[] => {
  const removed = new Set<Node>();
  const ctx: SafeHtmlContext = {
    removeNode: (node) => removed.add(node),
    setProperty: (node, key, value) => {
      if (value === null) delete node.properties?.[key];
      else node.properties = { ...node.properties, [key]: value };
    },
  };
  for (const node of nodes) {
    if (node.type === "raw") safeHtmlPlugin.raw(node, ctx);
    if (node.type === "element" && safeHtmlPlugin.element.filter.includes(node.tagName ?? "")) {
      safeHtmlPlugin.element.visit(node, ctx);
    }
  }
  return nodes.filter((node) => !removed.has(node));
};

describe("safeHtmlPlugin", () => {
  test("drops raw HTML and unsafe URLs, keeps safe ones", () => {
    const tree: Node[] = [
      { type: "raw", properties: { value: "<script>alert(1)</script>" } },
      { type: "element", tagName: "a", properties: { href: "javascript:alert(1)" } },
      { type: "element", tagName: "a", properties: { href: " JaVa\nScRiPt:alert(1)" } },
      { type: "element", tagName: "img", properties: { src: "data:image/svg+xml,<svg/>" } },
      { type: "element", tagName: "img", properties: { srcSet: ["a.png 1x", "data:x 2x"] } },
      { type: "element", tagName: "a", properties: { href: "https://pego.ink/docs" } },
      { type: "element", tagName: "a", properties: { href: "/settings#ai" } },
      { type: "element", tagName: "a", properties: { href: "#top" } },
      { type: "element", tagName: "a", properties: { href: "mailto:hi@pego.ink" } },
    ];
    expect(run(tree)).toEqual([
      { type: "element", tagName: "a", properties: {} },
      { type: "element", tagName: "a", properties: {} },
      { type: "element", tagName: "img", properties: {} },
      { type: "element", tagName: "img", properties: {} },
      { type: "element", tagName: "a", properties: { href: "https://pego.ink/docs" } },
      { type: "element", tagName: "a", properties: { href: "/settings#ai" } },
      { type: "element", tagName: "a", properties: { href: "#top" } },
      { type: "element", tagName: "a", properties: { href: "mailto:hi@pego.ink" } },
    ]);
  });
});

describe("isSafeUrl", () => {
  test("allows http(s), mailto, relative paths and fragments only", () => {
    for (const url of [
      "https://a.b",
      "http://a.b",
      "mailto:x@y.z",
      "/a",
      "./a",
      "a/b?c=d:e",
      "#x",
    ]) {
      expect([url, isSafeUrl(url)]).toEqual([url, true]);
    }
    for (const url of [
      "javascript:x",
      "vbscript:x",
      "data:x",
      "file:///etc",
      "ftp://x",
      "\u0001javascript:x",
    ]) {
      expect([url, isSafeUrl(url)]).toEqual([url, false]);
    }
  });
});
