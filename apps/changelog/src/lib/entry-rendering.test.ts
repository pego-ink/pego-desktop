import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import config from "../../astro.config";
import { unsafeText } from "@/lib/entry-body";

/**
 * End to end: hostile entry bodies through the Markdown pipeline the site builds with. The
 * processor is Astro's default (`satteri()` from `@astrojs/markdown-satteri`, resolved through
 * Astro's own dependencies), set up by the integrations in astro.config.ts and rendered with the
 * same options Astro passes when the config sets none (Shiki highlighting, GFM, smart punctuation).
 */

/** The slice of `@astrojs/markdown-satteri`'s processor this test drives. */
interface Renderer {
  render: (body: string) => Promise<{ code: string }>;
}
interface Processor {
  name: string;
  options: Record<string, unknown>;
  createRenderer: (shared: Record<string, unknown>) => Promise<Renderer>;
}

const astroDir = dirname(Bun.resolveSync("astro/package.json", import.meta.dir));
const { satteri } = (await import(Bun.resolveSync("@astrojs/markdown-satteri", astroDir))) as {
  satteri: () => Processor;
};

/** A renderer like the site's: Astro's default processor after every config:setup hook we own. */
const siteRenderer = async (): Promise<Renderer> => {
  const processor = satteri();
  for (const integration of config.integrations ?? []) {
    if (!integration || Array.isArray(integration) || !integration.name.startsWith("pego-"))
      continue;
    await integration.hooks["astro:config:setup"]?.({
      config: { markdown: { processor } },
    } as never);
  }
  return processor.createRenderer({});
};

const HOSTILE = [
  "[a](javascript\\:alert(1))",
  "[b](JaVaScRiPt:alert(1))",
  "[c](&#106;avascript:alert(1))",
  "[d](java&#x09;script&colon;alert(1))",
  "[e](\\javascript\\:alert(1) 'title')",
  "[f]\n\n[f]: javascript:alert(1)",
  "[g][h]\n\n[h]:\n  vbscript:msgbox",
  "<javascript:alert(1)>",
  "![i](data:image/svg+xml,%3Csvg%20onload=alert(1)%3E)",
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)" onclick="alert(1)">j</a>',
  "<svg><animate onbegin=alert(1) attributeName=x /></svg>",
  '<iframe src="javascript:alert(1)"></iframe>',
  "Text <b onmouseover=alert(1)>k</b> inline.",
  "<details open ontoggle=alert(1)>",
  "```html\n<script>alert(1)</script>\n```",
];

/** Every URL-valued attribute in `html`, entities decoded the way a browser would. */
const urls = (html: string): string[] =>
  [
    ...html.matchAll(
      /\s(?:href|src|srcset|action|formaction|poster|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    ),
  ].map(([, value = ""]) =>
    value
      .replace(/^["']|["']$/g, "")
      .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&colon;/gi, ":")
      .replace(/&amp;/gi, "&"),
  );

const expectSafe = (html: string): void => {
  // Raw HTML is dropped, so no tag the Markdown itself does not make; code is escaped text.
  expect(html).not.toMatch(/<\s*(script|iframe|svg|animate|object|embed|details|b)\b/i);
  // No event handler attributes on any tag.
  expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  for (const url of urls(html)) {
    // eslint-disable-next-line no-control-regex -- browsers skip these in a URL
    const folded = url.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
    expect(folded).not.toMatch(/^(javascript|vbscript|data|file):/);
  }
};

describe("rendering a hostile entry body", () => {
  test("without the safe-markdown plugin the pipeline does emit script URLs (control)", async () => {
    const plain = await satteri().createRenderer({});
    const { code } = await plain.render("[a](javascript\\:alert(1))");
    expect(code).toContain('href="javascript:alert(1)"');
  });

  test("the site's pipeline emits no script URLs, raw tags or event attributes", async () => {
    const renderer = await siteRenderer();
    for (const body of HOSTILE) {
      const { code } = await renderer.render(body);
      expectSafe(code);
    }
    const { code } = await renderer.render(HOSTILE.join("\n\n"));
    expectSafe(code);
  });

  test("safe links survive", async () => {
    const renderer = await siteRenderer();
    const { code } = await renderer.render(
      "[a](https://pego.ink/docs) [b](/settings#ai) [c](mailto:hi@pego.ink)",
    );
    expect(code).toContain('href="https://pego.ink/docs"');
    expect(code).toContain('href="/settings#ai"');
    expect(code).toContain('href="mailto:hi@pego.ink"');
  });

  test("the entry text rules already refuse every hostile body", () => {
    for (const body of HOSTILE) expect([body, unsafeText(body).length > 0]).toEqual([body, true]);
  });
});
