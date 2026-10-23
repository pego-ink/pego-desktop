import { describe, expect, test } from "bun:test";
import { APP_STATE_LIMIT, appStateContext, type AppState } from "./app-state";

const base: AppState = {
  document: { name: "Landing", file: null, page: "Page 1" },
  selection: [],
  topLevel: [],
  components: [],
  browser: null,
};

describe("appStateContext", () => {
  test("an empty page with nothing selected", () => {
    expect(appStateContext(base).split("\n")).toEqual([
      "Editor state when this message was sent (context only; the request says what to do):",
      '- Document: "Landing" (not saved to a file), page "Page 1"',
      "- Selected layers: none",
      "- Top-level layers on the page: none (the page is empty)",
      "- Components: none",
    ]);
  });

  test("layers in view come first; long lists are counted; the browser has its line", () => {
    const topLevel = Array.from({ length: APP_STATE_LIMIT + 2 }, (_, index) => ({
      id: `f${index}`,
      name: `Frame ${index}`,
      type: "frame",
      inView: index === 11,
    }));
    const text = appStateContext({
      ...base,
      document: { name: "Landing", file: "/repo/landing.pego", page: "Home" },
      selection: [{ id: "t1", name: "Title", type: "text" }],
      topLevel,
      components: [{ id: "c1", name: "Button", type: "frame" }],
      browser: {
        url: "https://example.com",
        picked: { label: "button.cta", selector: "main > button.cta" },
      },
    });
    expect(text).toContain('file /repo/landing.pego), page "Home"');
    expect(text).toContain('- Selected layers: `t1` (text): "Title"');
    expect(text).toContain(
      '- Top-level layers on the page: `f11` (frame): "Frame 11" [in view], `f0` (frame): "Frame 0" [outside the view]',
    );
    expect(text).toContain("+2 more");
    expect(text).toContain('- Components: `c1` (frame): "Button"');
    expect(text).toEndWith(
      "- In-app browser: open at https://example.com; picked element: button.cta (selector `main > button.cta`)",
    );
  });
});
