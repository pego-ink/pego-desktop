import { describe, expect, test } from "bun:test";
import { findNode } from "@pego/doc";
import type { BrowserHost, BrowserTarget, DomSnapshot } from "./browser-types";
import { createFakeHost } from "./test-host";
import { browserTools } from "./tools-browser";
import type { ToolHost } from "./types";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const tool = browserTools[0]!;
const WEBP = "data:image/webp;base64,UklGRg==";
const PNG_B64 = "iVBORw0KGgo=";

const snapshot: DomSnapshot = {
  url: "https://example.com/",
  title: "Example",
  root: {
    kind: "element",
    tag: "main",
    box: { x: 0, y: 0, width: 800, height: 600 },
    style: { backgroundColor: "rgb(250, 250, 250)" },
    children: [
      {
        kind: "text",
        text: "Hello",
        box: { x: 20, y: 20, width: 100, height: 30 },
        style: { fontSize: 24, color: "rgb(0, 0, 0)" },
      },
    ],
  },
};

const fakeBrowser = (overrides: Partial<BrowserHost> = {}) => {
  const calls: { fn: string; args: unknown[] }[] = [];
  let page: { url: string; title: string } | null = {
    url: "https://example.com/",
    title: "Example",
  };
  const browser: BrowserHost = {
    loadPage: async (url) => {
      calls.push({ fn: "loadPage", args: [url] });
      page = { url, title: "Example" };
      return page;
    },
    currentPage: () => page,
    screenshot: async (target, options) => {
      calls.push({ fn: "screenshot", args: [target, options] });
      return {
        dataUrl: options?.format === "webp" ? WEBP : `data:image/png;base64,${PNG_B64}`,
        width: 640,
        height: 480,
      };
    },
    snapshot: async (target: BrowserTarget) => {
      calls.push({ fn: "snapshot", args: [target] });
      return snapshot;
    },
    describeElement: async (target) => {
      calls.push({ fn: "describeElement", args: [target] });
      return "<div>hi</div>";
    },
    cdp: async (method, params) => {
      calls.push({ fn: "cdp", args: [method, params] });
      return { result: { value: 2 } };
    },
    ...overrides,
  };
  return { browser, calls, unload: () => (page = null) };
};

const withBrowser = (browser: BrowserHost) => Object.assign(createFakeHost(), { browser });

const call = async (input: unknown, host: ToolHost) => {
  const result = await tool.run(input, host);
  let data: Json = {};
  try {
    data = JSON.parse(result.content) as Json;
  } catch {
    // plain text result
  }
  return { result, isError: result.isError, data };
};

describe("browser tool", () => {
  test("is unsupported without a browser host", async () => {
    const { isError, data } = await call(
      { action: "load-page", url: "https://a.test" },
      createFakeHost(),
    );
    expect(isError).toBe(true);
    expect(data.error).toMatchObject({ code: "unsupported" });
    expect(data.error.message).toBe(
      "The in-app browser is only available in the Pego desktop app.",
    );
  });

  test("validates required inputs", async () => {
    const { browser } = fakeBrowser();
    const host = withBrowser(browser);
    expect((await call({ action: "load-page" }, host)).data.error.code).toBe("invalid_input");
    expect((await call({ action: "cdp" }, host)).data.error.code).toBe("invalid_input");
    expect(
      (await call({ action: "import-to-canvas", target: "query" }, host)).data.error.code,
    ).toBe("invalid_input");
    expect((await call({ action: "nope" }, host)).data.error.code).toBe("invalid_input");
  });

  test("load-page reports url and title", async () => {
    const { browser, calls } = fakeBrowser();
    const { isError, data } = await call(
      { action: "load-page", url: " https://example.com " },
      withBrowser(browser),
    );
    expect(isError).toBe(false);
    expect(data).toMatchObject({ ok: true, url: "https://example.com", title: "Example" });
    expect(calls[0]).toEqual({ fn: "loadPage", args: ["https://example.com"] });
  });

  test("other actions need a loaded page", async () => {
    const { browser, unload } = fakeBrowser();
    unload();
    const host = withBrowser(browser);
    for (const action of [
      "import-to-canvas",
      "screenshot-to-canvas",
      "return-element",
      "return-screenshot",
    ]) {
      const { isError, data } = await call({ action }, host);
      expect(isError).toBe(true);
      expect(data.error.code).toBe("no_page");
      expect(data.error.hint).toContain("load-page");
    }
    expect((await call({ action: "cdp", method: "Runtime.evaluate" }, host)).data.error.code).toBe(
      "no_page",
    );
  });

  test("import-to-canvas inserts one frame in one op beside existing content", async () => {
    const { browser, calls } = fakeBrowser();
    const host = withBrowser(browser);
    const before = host.calls.applyOps.length;
    const { isError, data } = await call(
      { action: "import-to-canvas", target: "query", querySelector: "main" },
      host,
    );
    expect(isError).toBe(false);
    expect(calls[0]?.args[0]).toEqual({ kind: "query", selector: "main" });
    expect(host.calls.applyOps.length).toBe(before + 1);
    expect(host.calls.applyOps.at(-1)).toHaveLength(1);
    expect(data).toMatchObject({ ok: true, nodeCount: 2, width: 800, height: 600 });
    const node = findNode(host.getDoc(), data.created.id);
    expect(node).toMatchObject({ type: "frame", name: "main", clip: true });
    expect(host.calls.focus.at(-1)).toContain(data.created.id);
  });

  test("import-to-canvas names a full page after its title and caps warnings", async () => {
    const warnings = Array.from({ length: 40 }, (_, i) => ({
      kind: "svg" as const,
      markup: `bad ${i}`,
      box: { x: 0, y: i, width: 10, height: 10 },
      style: {},
    }));
    const { browser } = fakeBrowser({
      snapshot: async () => ({
        ...snapshot,
        root: {
          ...(snapshot.root as Json),
          tag: "body",
          children: [...(snapshot.root as Json).children, ...warnings],
        } as DomSnapshot["root"],
      }),
    });
    const host = withBrowser(browser);
    const { data } = await call({ action: "import-to-canvas" }, host);
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({ name: "Example" });
    expect(data.warnings.length).toBeLessThanOrEqual(20);
  });

  test("screenshot-to-canvas inserts an image node sized like the screenshot", async () => {
    const { browser, calls } = fakeBrowser();
    const host = withBrowser(browser);
    const { isError, data } = await call(
      { action: "screenshot-to-canvas", target: "selection" },
      host,
    );
    expect(isError).toBe(false);
    expect(calls[0]).toEqual({
      fn: "screenshot",
      args: [{ kind: "selection" }, { format: "webp", maxSide: 2560 }],
    });
    expect(findNode(host.getDoc(), data.created.id)).toMatchObject({
      type: "image",
      src: WEBP,
      width: 640,
      height: 480,
    });
  });

  test("screenshot-to-canvas rejects an unusable screenshot", async () => {
    const { browser } = fakeBrowser({
      screenshot: async () => ({ dataUrl: "http://evil.test/a.png", width: 1, height: 1 }),
    });
    const { data } = await call({ action: "screenshot-to-canvas" }, withBrowser(browser));
    expect(data.error.code).toBe("invalid_src");
  });

  test("return-screenshot returns a png image without the data: prefix", async () => {
    const { browser, calls } = fakeBrowser();
    const { result, isError } = await call({ action: "return-screenshot" }, withBrowser(browser));
    expect(isError).toBe(false);
    expect(result.images).toEqual([
      { mediaType: "image/png", data: PNG_B64, width: 640, height: 480 },
    ]);
    expect(result.content).toContain("640x480");
    expect(calls[0]?.args[1]).toEqual({ format: "png", maxSide: 1568 });
  });

  test("return-element returns text and truncates long output", async () => {
    const { browser } = fakeBrowser();
    expect((await call({ action: "return-element" }, withBrowser(browser))).result.content).toBe(
      "<div>hi</div>",
    );
    const big = fakeBrowser({ describeElement: async () => "x".repeat(100_000) });
    const { result } = await call({ action: "return-element" }, withBrowser(big.browser));
    expect(result.content.length).toBeLessThan(41_000);
    expect(result.content).toContain("truncated");
  });

  test("cdp only allows the safe domains", async () => {
    const { browser, calls } = fakeBrowser();
    const host = withBrowser(browser);
    for (const method of [
      "Network.enable",
      "Fetch.enable",
      "Target.createTarget",
      "Browser.close",
      "evaluate",
      "FileSystem.x",
    ]) {
      const { isError, data } = await call({ action: "cdp", method }, host);
      expect(isError).toBe(true);
      expect(data.error.code).toBe("cdp_not_allowed");
    }
    expect(calls).toHaveLength(0);
    for (const method of [
      "DOM.getDocument",
      "Input.dispatchMouseEvent",
      "Page.reload",
      "Runtime.evaluate",
      "Emulation.setDeviceMetricsOverride",
      "CSS.enable",
      "Accessibility.getFullAXTree",
    ]) {
      expect((await call({ action: "cdp", method }, host)).isError).toBe(false);
    }
  });

  test("cdp returns JSON text, and screenshots as images", async () => {
    const { browser, calls } = fakeBrowser();
    const host = withBrowser(browser);
    const evaluated = await call(
      { action: "cdp", method: "Runtime.evaluate", params: { expression: "1+1" } },
      host,
    );
    expect(JSON.parse(evaluated.result.content)).toEqual({ result: { value: 2 } });
    expect(calls[0]?.args).toEqual(["Runtime.evaluate", { expression: "1+1" }]);

    const shot = fakeBrowser({ cdp: async () => ({ data: PNG_B64 }) });
    const { result } = await call(
      { action: "cdp", method: "Page.captureScreenshot" },
      withBrowser(shot.browser),
    );
    expect(result.images?.[0]).toMatchObject({ mediaType: "image/png", data: PNG_B64 });
  });

  test("host rejections become error results", async () => {
    const boom = fakeBrowser({
      loadPage: async () => {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      },
      snapshot: async () => {
        throw new Error("selector matched nothing");
      },
      screenshot: async () => {
        throw new Error("no element picked");
      },
      describeElement: async () => {
        throw new Error("gone");
      },
      cdp: async () => {
        throw new Error("cdp refused");
      },
    });
    const host = withBrowser(boom.browser);
    for (const [input, message] of [
      [{ action: "load-page", url: "https://nope.test" }, "ERR_NAME_NOT_RESOLVED"],
      [{ action: "import-to-canvas" }, "selector matched nothing"],
      [{ action: "return-screenshot", target: "selection" }, "no element picked"],
      [{ action: "screenshot-to-canvas" }, "no element picked"],
      [{ action: "return-element" }, "gone"],
      [{ action: "cdp", method: "DOM.enable" }, "cdp refused"],
    ] as const) {
      const { isError, data } = await call(input, host);
      expect(isError).toBe(true);
      expect(data.error.code).toBe("browser_error");
      expect(data.error.message).toContain(message);
    }
  });

  test("an empty import is an error, not an empty frame", async () => {
    const { browser } = fakeBrowser({
      snapshot: async () => ({
        ...snapshot,
        root: {
          ...(snapshot.root as Json),
          box: { x: 0, y: 0, width: 0, height: 0 },
        } as DomSnapshot["root"],
      }),
    });
    const { isError, data } = await call({ action: "import-to-canvas" }, withBrowser(browser));
    expect(isError).toBe(true);
    expect(data.error.code).toBe("empty_import");
  });
});
