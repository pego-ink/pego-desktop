import type { AstroIntegration } from "astro";

/**
 * Site-level defense for entry markdown (the validators in entry-body.ts are the first layer).
 * A hast plugin for Astro's Markdown processor (Sätteri) that drops every raw HTML node and removes
 * URL attributes whose scheme is not http(s) or mailto. Relative paths and #fragments stay.
 */

/** The slice of a hast node this plugin reads. */
interface HastNodeLike {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
}

/** The slice of Sätteri's visitor context this plugin uses. */
export interface SafeHtmlContext {
  removeNode(node: HastNodeLike): void;
  setProperty(node: HastNodeLike, key: string, value: unknown): void;
}

/** hast property names that hold a URL (or, for srcSet, a list of them). */
const URL_PROPERTIES = ["href", "src", "srcSet", "xLinkHref", "poster", "action", "formAction"];
/** Every element that can carry one of them. */
const URL_ELEMENTS = ["a", "img", "image", "use", "source", "video", "audio", "area", "form"];

// eslint-disable-next-line no-control-regex -- control characters are what it removes
const IGNORED = /[\s\u0000-\u001f\u007f-\u009f]/g;

/** True for http(s):, mailto:, a relative path or a #fragment (after removing what browsers skip). */
export const isSafeUrl = (value: string): boolean => {
  const url = value.replace(IGNORED, "").toLowerCase();
  const scheme = /^([^/?#]*?):/.exec(url)?.[1];
  return scheme === undefined || scheme === "http" || scheme === "https" || scheme === "mailto";
};

/** A srcset is a comma-separated list of "url descriptor" pairs; check each url. */
const isSafeSrcSet = (value: string): boolean =>
  value.split(",").every((part) => isSafeUrl(part.trim().split(/\s+/)[0] ?? ""));

const isSafeValue = (key: string, value: unknown): boolean => {
  if (Array.isArray(value)) return value.every((item) => isSafeValue(key, item));
  if (typeof value !== "string") return false;
  return key === "srcSet" ? isSafeSrcSet(value) : isSafeUrl(value);
};

/** The hast plugin (Sätteri's `HastPluginDefinition` shape). */
export const safeHtmlPlugin = {
  name: "pego-safe-html",
  raw: (node: HastNodeLike, ctx: SafeHtmlContext): void => {
    ctx.removeNode(node);
  },
  element: {
    filter: URL_ELEMENTS,
    visit: (node: HastNodeLike, ctx: SafeHtmlContext): void => {
      for (const key of URL_PROPERTIES) {
        const value = node.properties?.[key];
        if (value !== undefined && value !== null && !isSafeValue(key, value)) {
          ctx.setProperty(node, key, null);
        }
      }
    },
  },
};

/** Adds `safeHtmlPlugin` to the Markdown processor Astro resolved (Sätteri by default). */
export const safeMarkdown = (): AstroIntegration => ({
  name: "pego-safe-markdown",
  hooks: {
    "astro:config:setup": ({ config }) => {
      const options = config.markdown.processor.options as { hastPlugins?: unknown[] };
      if (!Array.isArray(options.hastPlugins)) {
        throw new Error("safe-markdown: the Markdown processor takes no hastPlugins");
      }
      options.hastPlugins.push(safeHtmlPlugin);
    },
  },
});
