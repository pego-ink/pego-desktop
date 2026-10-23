import { describe, expect, test } from "bun:test";
import { variablesSchema } from "@pego/doc";
import { coreSkill, skills } from "../skills/index";
import { stylePresets } from "../styles/index";
import { inspectTools } from "../tools-inspect";
import { agentTools } from "../tools";
import { contrastBetweenHex } from "./color";
import { checkLayout, type LayoutIssue } from "./check-layout";
import { findEmptySpace } from "./empty-space";
import { scoreIcon, searchIcons } from "./search";
import { createInspectHost, ICONS, layoutOf, makeDoc, PNG } from "./test-helpers";
import type { ToolHost } from "../types";

const tool = (name: string) => {
  const found = inspectTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const call = async (host: ToolHost, name: string, input: unknown = {}) => {
  const result = await tool(name).run(input, host);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...result, json: JSON.parse(result.content) as Record<string, any> };
};

const issuesOf = (children: unknown[], nodeId?: string): LayoutIssue[] => {
  const doc = makeDoc(children);
  return checkLayout(doc, layoutOf(doc), nodeId).issues;
};

const frame = (id: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  type: "frame",
  id,
  children,
  ...props,
});
const rect = (id: string, props: Record<string, unknown> = {}) => ({
  type: "rectangle",
  id,
  ...props,
});
const text = (id: string, content: string, props: Record<string, unknown> = {}) => ({
  type: "text",
  id,
  content,
  ...props,
});

describe("registry", () => {
  test("inspect tools are registered with unique snake_case names", () => {
    const names = inspectTools.map((t) => t.name);
    expect(names).toEqual([
      "get_screenshot",
      "check_layout",
      "find_empty_space",
      "find_nodes",
      "get_selection",
      "set_selection",
      "focus_nodes",
      "search_icons",
      "list_skills",
      "get_skill",
      "get_guidelines",
      "list_styles",
      "get_style",
    ]);
    const all = agentTools.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
    for (const t of inspectTools) expect(t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe("contrast math", () => {
  test("known WCAG pairs", () => {
    expect(contrastBetweenHex("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastBetweenHex("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastBetweenHex("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastBetweenHex("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
    expect(contrastBetweenHex("#0000ff", "#ffffff")).toBeCloseTo(8.59, 1);
    expect(contrastBetweenHex("#ff0000", "#000000")).toBeCloseTo(5.25, 1);
  });

  test("short hex and alpha are understood", () => {
    expect(contrastBetweenHex("#000", "#fff")).toBeCloseTo(21, 1);
    expect(contrastBetweenHex("#00000000", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastBetweenHex("nope", "#fff")).toBeNull();
  });
});

describe("check_layout rules", () => {
  test("clean document has no issues", () => {
    const issues = issuesOf([
      frame(
        "page",
        { name: "Card", layout: "vertical", width: 400, padding: 16, gap: 8, fill: "#ffffff" },
        [
          text("t", "Hello", { fill: "#111111" }),
          rect("r", { width: "fill_container", height: 40, fill: "#eeeeee" }),
        ],
      ),
    ]);
    expect(issues).toEqual([]);
  });

  test("loose layers at the top level of a page are flagged; unnamed top-level frames too", () => {
    const issues = issuesOf([
      frame("cloud", { name: "Cloud", width: 120, height: 60, layout: "none" }, [
        { type: "ellipse", id: "puff", x: 0, y: 0, width: 60, height: 40, fill: "#ffffff" },
      ]),
      { type: "ellipse", id: "stray", x: 300, y: 0, width: 60, height: 40, fill: "#ffffff" },
      text("caption", "Sky", { x: 300, y: 80, fill: "#111111" }),
      frame("nameless", { width: 50, height: 50, fill: "#eeeeee" }),
    ]);
    const byId = (id: string) => issues.filter((i) => i.nodeId === id);
    expect(byId("stray")).toMatchObject([
      { severity: "warning", issue: "ellipse sits loose at the top level of the page" },
    ]);
    expect(byId("caption")[0]?.hint).toContain("wrap it together with the layers");
    expect(byId("nameless")).toMatchObject([
      { severity: "info", issue: "top-level frame has no name" },
    ]);
    expect(byId("cloud")).toEqual([]);
    expect(byId("puff")).toEqual([]);
  });

  test("child overflowing a non-clipping parent is a warning, a clipping parent an error", () => {
    const children = (clip: boolean) => [
      frame("p", { width: 100, height: 100, clip, layout: "none" }, [
        rect("c", { x: 60, y: 0, width: 80, height: 20, fill: "#000000" }),
      ]),
    ];
    const open = issuesOf(children(false)).find((i) => i.nodeId === "c");
    expect(open?.severity).toBe("warning");
    expect(open?.issue).toContain("right 40");
    const clipped = issuesOf(children(true)).find((i) => i.nodeId === "c");
    expect(clipped?.severity).toBe("error");
    expect(clipped?.issue).toContain("clips");
  });

  test("flex overflow is found from computed boxes", () => {
    const issues = issuesOf([
      frame("row", { layout: "horizontal", width: 100, height: 40 }, [
        rect("a", { width: 70, height: 10, fill: "#000000" }),
        rect("b", { width: 70, height: 10, fill: "#000000" }),
      ]),
    ]);
    expect(issues.some((i) => i.nodeId === "b" && i.issue.includes("outside"))).toBe(true);
    expect(issues.some((i) => i.nodeId === "a" && i.issue.includes("outside"))).toBe(false);
  });

  test("text taller than its fixed height", () => {
    const issues = issuesOf([
      frame("p", { width: 200, height: 200, layout: "none" }, [
        text("t", "a".repeat(120), { width: 100, height: 20, fontSize: 16 }),
      ]),
    ]);
    expect(issues.some((i) => i.nodeId === "t" && i.issue.includes("fixed at 20px"))).toBe(true);
  });

  test("zero-size shapes and collapsed frames are errors", () => {
    const issues = issuesOf([
      frame("p", { width: 200, height: 200, layout: "none" }, [
        rect("z", { fill: "#000000" }),
        frame("collapsed", { fill: "#cccccc" }),
      ]),
    ]);
    expect(issues.find((i) => i.nodeId === "z")?.severity).toBe("error");
    expect(issues.find((i) => i.nodeId === "collapsed")?.issue).toContain("0x0");
  });

  test("partial overlap is flagged, containment is not", () => {
    const issues = issuesOf([
      frame("p", { width: 300, height: 300, layout: "none" }, [
        rect("bg", { x: 0, y: 0, width: 300, height: 300, fill: "#eeeeee" }),
        rect("a", { x: 20, y: 20, width: 100, height: 100, fill: "#000000" }),
        rect("b", { x: 80, y: 80, width: 100, height: 100, fill: "#111111" }),
      ]),
    ]);
    const overlaps = issues.filter((i) => i.issue.includes("overlaps sibling"));
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.nodeId).toBe("b");
    expect(overlaps[0]?.issue).toContain("40x40");
  });

  test("overlapping text is an error", () => {
    const issues = issuesOf([
      frame("p", { width: 300, height: 100, layout: "none" }, [
        text("a", "Hello world", { x: 0, y: 0 }),
        text("b", "Overlap", { x: 20, y: 5 }),
      ]),
    ]);
    expect(issues.find((i) => i.issue.includes("overlaps"))?.severity).toBe("error");
  });

  test("x/y on flex children is info", () => {
    const issues = issuesOf([
      frame("col", { layout: "vertical", width: 100, height: 100 }, [
        rect("r", { x: 30, y: 10, width: 20, height: 20, fill: "#000000" }),
      ]),
    ]);
    const hit = issues.find((i) => i.nodeId === "r");
    expect(hit?.severity).toBe("info");
    expect(hit?.issue).toContain("ignored");
  });

  test("contrast uses the nearest ancestor fill and resolves variables", () => {
    const doc = makeDoc(
      [
        frame("dark", { width: 200, height: 100, layout: "vertical", fill: "$bg" }, [
          frame("light", { layout: "vertical", padding: 8, fill: "#ffffff" }, [
            text("low", "Low contrast", { fill: "$muted", fontSize: 14 }),
            text("ok", "Fine", { fill: "#000000" }),
          ]),
          text("onDark", "On dark", { fill: "#111111", fontSize: 14 }),
        ]),
      ],
      { bg: { type: "color", value: "#101010" }, muted: { type: "color", value: "#8a8a8a" } },
    );
    const issues = checkLayout(doc, layoutOf(doc)).issues;
    expect(issues.find((i) => i.nodeId === "low")?.issue).toContain("contrast");
    expect(issues.find((i) => i.nodeId === "low")?.severity).toBe("warning");
    expect(issues.find((i) => i.nodeId === "ok")).toBeUndefined();
    expect(issues.find((i) => i.nodeId === "onDark")?.severity).toBe("error");
  });

  test("large text only needs 3:1", () => {
    const issues = issuesOf([
      frame("p", { width: 300, height: 100, layout: "vertical", fill: "#ffffff" }, [
        text("big", "Heading", { fill: "#888888", fontSize: 32 }),
        text("small", "Body copy", { fill: "#888888", fontSize: 14 }),
      ]),
    ]);
    expect(issues.find((i) => i.nodeId === "big")).toBeUndefined();
    expect(issues.find((i) => i.nodeId === "small")).toBeDefined();
  });

  test("fill_container children in a hugging parent are circular", () => {
    const issues = issuesOf([
      frame("outer", { layout: "vertical", width: 300 }, [
        frame("hug", { layout: "vertical" }, [
          rect("a", { width: "fill_container", height: 10, fill: "#000000" }),
        ]),
      ]),
    ]);
    const hit = issues.find((i) => i.nodeId === "hug" && i.issue.includes("circular"));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  test("mixed fill and fixed children are fine", () => {
    const issues = issuesOf([
      frame("hug", { layout: "vertical" }, [
        rect("a", { width: "fill_container", height: 10, fill: "#000000" }),
        rect("b", { width: 120, height: 10, fill: "#000000" }),
      ]),
    ]);
    expect(issues.find((i) => i.issue.includes("circular"))).toBeUndefined();
  });

  test("empty unpainted frames are reported, painted ones are not", () => {
    const issues = issuesOf([
      frame("p", { width: 300, height: 300, layout: "none" }, [
        frame("empty", { x: 10, y: 10, width: 50, height: 50 }),
        frame("painted", { x: 100, y: 10, width: 50, height: 50, fill: "#cccccc" }),
      ]),
    ]);
    expect(issues.find((i) => i.nodeId === "empty")?.issue).toContain("empty frame");
    expect(issues.find((i) => i.nodeId === "painted")).toBeUndefined();
  });

  test("sorted by severity, capped at 50, scoped by nodeId", () => {
    const many = Array.from({ length: 70 }, (_, i) => rect(`z${i}`, { fill: "#000000" }));
    const doc = makeDoc([
      frame("p", { name: "P", width: 100, height: 100, layout: "none" }, many),
      frame("q", { name: "Q", width: 100, height: 100, layout: "none" }, [
        rect("only", { fill: "#000000" }),
      ]),
    ]);
    const report = checkLayout(doc, layoutOf(doc));
    expect(report.total).toBe(71);
    expect(report.issues).toHaveLength(50);
    expect(report.summary).toContain("71 issue(s)");
    const scoped = checkLayout(doc, layoutOf(doc), "q");
    expect(scoped.issues.map((i) => i.nodeId)).toEqual(["only"]);
  });

  test("instance internals are checked with an actionable hint", () => {
    const doc = makeDoc([
      frame("comp", { reusable: true, width: 100, height: 40, layout: "none", fill: "#ffffff" }, [
        text("label", "Hi", { fill: "#000000" }),
      ]),
      { type: "ref", id: "inst", ref: "comp", x: 200, descendants: { label: { fill: "#fefefe" } } },
    ]);
    const issues = checkLayout(doc, layoutOf(doc)).issues;
    const hit = issues.find((i) => i.nodeId === "inst/label");
    expect(hit?.hint).toContain("set_instance_overrides");
  });
});

describe("check_layout tool", () => {
  const doc = makeDoc([frame("p", { width: 100, height: 100 }, [rect("z", { fill: "#000" })])]);

  test("happy path", async () => {
    const out = await call(createInspectHost(doc), "check_layout");
    expect(out.isError).toBe(false);
    expect(out.json.issues.length).toBeGreaterThan(0);
    expect(out.json.summary).toContain("issue");
  });

  test("unsupported without getLayout, unknown node errors", async () => {
    const out = await call(createInspectHost(doc, ["getLayout"]), "check_layout");
    expect(out.isError).toBe(true);
    expect(out.json.error.code).toBe("unsupported");
    const missing = await call(createInspectHost(doc), "check_layout", { nodeId: "nope" });
    expect(missing.json.error.code).toBe("node_not_found");
  });
});

describe("find_empty_space", () => {
  const doc = makeDoc([
    frame("a", { x: 0, y: 0, width: 400, height: 300 }),
    frame("b", { x: 480, y: 0, width: 400, height: 600 }),
    frame("c", { x: 0, y: 380, width: 400, height: 200 }),
  ]);
  const layout = layoutOf(doc);
  const boxes = ["a", "b", "c"].map((id) => layout.get(id)!);
  const clear = (p: { x: number; y: number; width: number; height: number }, gap = 0) =>
    boxes.every(
      (b) =>
        p.x + p.width + gap <= b.x ||
        b.x + b.width + gap <= p.x ||
        p.y + p.height + gap <= b.y ||
        b.y + b.height + gap <= p.y,
    );

  test("never overlaps for any direction, anchor and padding", () => {
    for (const direction of ["right", "below", "left", "above"] as const) {
      for (const nearNodeId of [undefined, "a", "b", "c"]) {
        for (const padding of [0, 40, 80]) {
          const p = findEmptySpace(doc, layout, {
            width: 390,
            height: 844,
            direction,
            nearNodeId,
            padding,
          });
          expect(clear(p, padding)).toBe(true);
        }
      }
    }
  });

  test("slides past a blocker and honors the direction", () => {
    const right = findEmptySpace(doc, layout, { width: 300, height: 300, nearNodeId: "a" });
    expect(right.x).toBe(960); // past b (480 + 400 + 80)
    expect(right.y).toBe(0);
    const below = findEmptySpace(doc, layout, {
      width: 300,
      height: 100,
      nearNodeId: "a",
      direction: "below",
    });
    expect(below.x).toBe(0);
    expect(below.y).toBeGreaterThanOrEqual(580 + 80);
  });

  test("empty canvas starts at origin", () => {
    const empty = makeDoc([]);
    expect(findEmptySpace(empty, layoutOf(empty), { width: 10, height: 10 })).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  test("tool returns coordinates and validates the anchor", async () => {
    const host = createInspectHost(doc);
    const out = await call(host, "find_empty_space", { width: 390, height: 844, nearNodeId: "b" });
    expect(out.json.x).toBe(960);
    expect(
      (await call(host, "find_empty_space", { width: 1, height: 1, nearNodeId: "x" })).isError,
    ).toBe(true);
    const bad = await call(createInspectHost(doc, ["getLayout"]), "find_empty_space", {
      width: 1,
      height: 1,
    });
    expect(bad.json.error.code).toBe("unsupported");
  });
});

describe("find_nodes", () => {
  const doc = makeDoc([
    frame("hero", { name: "Hero", width: 400, height: 200 }, [
      text("h1", "Ship faster with Pego", { name: "Headline" }),
      { type: "icon", id: "ic", name: "Arrow", iconName: "arrow-right" },
    ]),
    frame("foot", { name: "Footer", width: 400, height: 50 }, [text("f1", "Contact us")]),
  ]);

  test("filters combine and report boxes", async () => {
    const host = createInspectHost(doc);
    const byText = await call(host, "find_nodes", { text: "pego" });
    expect(byText.json.matches).toHaveLength(1);
    expect(byText.json.matches[0]).toMatchObject({ id: "h1", parentId: "hero", name: "Headline" });
    expect(byText.json.matches[0].box).toBeDefined();
    const within = await call(host, "find_nodes", { type: "text", withinId: "foot" });
    expect(within.json.matches.map((m: { id: string }) => m.id)).toEqual(["f1"]);
    const query = await call(host, "find_nodes", { query: "arrow-right" });
    expect(query.json.matches.map((m: { id: string }) => m.id)).toEqual(["ic"]);
    const limited = await call(host, "find_nodes", { type: "frame", limit: 1 });
    expect(limited.json).toMatchObject({ total: 2, shown: 1 });
  });

  test("works without layout; rejects unknown withinId", async () => {
    const host = createInspectHost(doc, ["getLayout"]);
    const out = await call(host, "find_nodes", { name: "foot" });
    expect(out.json.matches[0].box).toBeUndefined();
    expect((await call(host, "find_nodes", { withinId: "zz" })).json.error.code).toBe(
      "node_not_found",
    );
  });
});

describe("selection and viewport tools", () => {
  const doc = makeDoc([frame("a", { name: "Card", width: 100, height: 50 }, [text("t", "Hi")])]);

  test("get_selection serializes selected nodes", async () => {
    const host = createInspectHost(doc);
    host.selection = ["a", "ghost"];
    const out = await call(host, "get_selection");
    expect(out.json.count).toBe(1);
    expect(out.json.selection[0].node).toContain("frame#a");
    expect(out.json.selection[0].node).toContain("text#t");
    expect(out.json.selection[0].box).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    host.selection = [];
    expect((await call(host, "get_selection")).json.note).toContain("Nothing is selected");
  });

  test("set_selection and focus_nodes", async () => {
    const host = createInspectHost(doc);
    expect((await call(host, "set_selection", { ids: ["t"] })).isError).toBe(false);
    expect(host.selection).toEqual(["t"]);
    expect((await call(host, "set_selection", { ids: ["nope"] })).json.error.code).toBe(
      "node_not_found",
    );
    const out = await call(host, "focus_nodes", { ids: ["a"], select: true });
    expect(host.viewport).toEqual([["a"]]);
    expect(host.selection).toEqual(["a"]);
    expect(out.json.selected).toBe(true);
    await call(host, "focus_nodes", { ids: ["t"] });
    expect(host.selection).toEqual(["a"]);
  });

  test("unsupported paths", async () => {
    const none = createInspectHost(doc, ["getSelection", "setSelection", "focusViewport"]);
    for (const [name, input] of [
      ["get_selection", {}],
      ["set_selection", { ids: ["a"] }],
      ["focus_nodes", { ids: ["a"] }],
    ] as const) {
      const out = await call(none, name, input);
      expect(out.isError).toBe(true);
      expect(out.json.error.code).toBe("unsupported");
    }
  });
});

describe("get_screenshot", () => {
  const doc = makeDoc([frame("a", { name: "Hero", width: 100, height: 50 })]);

  test("renders with defaults and returns the image", async () => {
    const host = createInspectHost(doc);
    const out = await call(host, "get_screenshot", { nodeId: "a" });
    expect(out.isError).toBe(false);
    expect(out.images).toEqual([PNG]);
    expect(out.json).toMatchObject({ nodeId: "a", name: "Hero", width: 100, height: 50 });
    expect(host.renders).toEqual([{ nodeId: "a", scale: 1, maxSize: 1600 }]);
  });

  test("rejects scale above 2, unknown node, and missing capability", async () => {
    const host = createInspectHost(doc);
    expect((await call(host, "get_screenshot", { nodeId: "a", scale: 3 })).json.error.code).toBe(
      "invalid_input",
    );
    expect((await call(host, "get_screenshot", { nodeId: "zz" })).json.error.code).toBe(
      "node_not_found",
    );
    const none = createInspectHost(doc, ["renderImage"]);
    expect((await call(none, "get_screenshot", { nodeId: "a" })).json.error.code).toBe(
      "unsupported",
    );
  });
});

describe("search_icons", () => {
  test("ranks exact, prefix and word matches before fuzzy", () => {
    expect(searchIcons(ICONS, "calendar", 5)).toEqual([
      "calendar",
      "calendar-days",
      "calendar-check",
    ]);
    expect(searchIcons(ICONS, "arrow right", 5)[0]).toBe("arrow-right");
    expect(searchIcons(ICONS, "arrow-right", 5).slice(0, 3)).toEqual([
      "arrow-right",
      "arrow-up-right",
      "circle-arrow-right",
    ]);
    expect(searchIcons(ICONS, "cal", 3)).toEqual(["calendar", "calendar-days", "calendar-check"]);
    expect(searchIcons(ICONS, "zzzz", 5)).toEqual([]);
  });

  test("whole-word beats substring and every word must match", () => {
    expect(scoreIcon("user", "user")).toBeGreaterThan(scoreIcon("users", "user"));
    expect(scoreIcon("arrow-left", "arrow right")).toBe(0);
  });

  test("tool paths", async () => {
    const host = createInspectHost(makeDoc([]));
    const out = await call(host, "search_icons", { query: "arrow", limit: 2 });
    expect(out.json.icons).toHaveLength(2);
    const none = await call(createInspectHost(makeDoc([]), ["listIcons"]), "search_icons", {
      query: "x",
    });
    expect(none.json.error.code).toBe("unsupported");
  });
});

describe("skills and styles", () => {
  const FAKE_CORE = {
    id: "fake-core",
    title: "Fake core",
    description: "Applies to everything",
    keywords: [],
    content: "Run check_layout.",
    checklist: ["No overflow"],
    styles: ["calm"],
    core: true,
  };
  const FAKE_LANDING = {
    id: "fake-landing",
    title: "Fake landing",
    description: "Marketing pages",
    keywords: ["landing page"],
    content: "Hero first.",
    checklist: ["One CTA"],
    styles: ["bold"],
  };
  const withFakeSkills = async (run: () => Promise<void>) => {
    const added = [FAKE_CORE, FAKE_LANDING];
    skills.unshift(...added);
    try {
      await run();
    } finally {
      for (const fake of added) skills.splice(skills.indexOf(fake), 1);
    }
  };

  test("list_skills returns summaries without content", async () => {
    await withFakeSkills(async () => {
      const list = await call(createInspectHost(makeDoc([])), "list_skills");
      const ids = list.json.skills.map((s: { id: string }) => s.id);
      expect(ids).toContain("fake-landing");
      const landing = list.json.skills.find((s: { id: string }) => s.id === "fake-landing");
      expect(landing).toEqual({
        id: "fake-landing",
        title: "Fake landing",
        category: "design",
        description: "Marketing pages",
        styles: ["bold"],
      });
    });
  });

  test("get_skill returns content, checklist and styles; rejects unknown ids", async () => {
    await withFakeSkills(async () => {
      const host = createInspectHost(makeDoc([]));
      const one = await call(host, "get_skill", { id: "fake-landing" });
      expect(one.json).toMatchObject({
        id: "fake-landing",
        content: "Hero first.",
        checklist: ["One CTA"],
        styles: ["bold"],
      });
      const miss = await call(host, "get_skill", { id: "nope" });
      expect(miss.json.error.code).toBe("unknown_skill");
      expect(miss.json.error.hint).toContain("list_skills");
    });
  });

  test("get_guidelines is a thin alias over skills", async () => {
    await withFakeSkills(async () => {
      const host = createInspectHost(makeDoc([]));
      const list = await call(host, "get_guidelines");
      expect(list.json.skills.length).toBe(skills.length);
      expect(list.json.skills[0].content).toBeUndefined();
      expect((await call(host, "get_guidelines", { topic: "fake-landing" })).json.content).toBe(
        "Hero first.",
      );
      const overview = await call(host, "get_guidelines", { topic: "overview" });
      expect(overview.json.id).toBe(coreSkill()?.id);
      expect((await call(host, "get_guidelines", { topic: "nope" })).json.error.code).toBe(
        "unknown_topic",
      );
    });
  });

  test("built-in skills only mention real tools", () => {
    const names = new Set(agentTools.map((t) => t.name));
    const allowed = ["fill_container", "fit_content", "space_between", "space_around"];
    for (const skill of skills) {
      const text = [skill.content, ...skill.checklist].join("\n");
      for (const m of text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
        const word = m[1] as string;
        expect(names.has(word) || allowed.includes(word)).toBe(true);
      }
    }
  });

  test("styles: distinct presets whose variables parse and pass contrast", () => {
    expect(stylePresets.length).toBe(20);
    expect(new Set(stylePresets.map((s) => s.name)).size).toBe(stylePresets.length);
    expect(new Set(stylePresets.map((s) => s.variables.accent?.value)).size).toBe(
      stylePresets.length,
    );
    for (const style of stylePresets) {
      expect(variablesSchema.safeParse(style.variables).success).toBe(true);
      const hex = (name: string) => style.variables[name]?.value as string;
      const ratio = (fg: string, bg: string) => contrastBetweenHex(hex(fg), hex(bg)) ?? 0;
      for (const surface of ["bg", "surface", "surface-2"]) {
        expect(ratio("text", surface)).toBeGreaterThanOrEqual(7);
        expect(ratio("text-muted", surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio("on-accent", "accent")).toBeGreaterThanOrEqual(4.5);
      expect(ratio("accent", "surface")).toBeGreaterThanOrEqual(3);
      expect(style.dos.length).toBeGreaterThan(1);
      expect(style.donts.length).toBeGreaterThan(1);
      expect(Object.keys(style.variables)).toContain("radius-md");
    }
  });

  test("list_styles and get_style", async () => {
    const host = createInspectHost(makeDoc([]));
    const list = await call(host, "list_styles");
    expect(list.json.styles.length).toBe(stylePresets.length);
    expect(list.json.styles[0].variables).toBeUndefined();
    const style = await call(host, "get_style", { name: "Midnight Product" });
    expect(style.isError).toBe(false);
    expect(variablesSchema.safeParse(style.json.variables).success).toBe(true);
    // Ready for set_variables: applying it works end to end.
    const setVariables = agentTools.find((t) => t.name === "set_variables")!;
    const applied = await setVariables.run({ variables: style.json.variables }, host);
    expect(applied.isError).toBe(false);
    expect((await call(host, "get_style", { name: "nope" })).json.error.code).toBe("unknown_style");
  });
});

describe("contrast background", () => {
  const contrastIssues = (children: unknown[]) =>
    issuesOf(children).filter((issue) => issue.issue.includes("contrast"));

  test("text on a shape drawn below it is measured against that shape", () => {
    // White text over a red frame, both on a white page (the earlier false positive).
    const page = (redFirst: boolean) => {
      const red = frame("red", { x: 0, y: 0, width: 400, height: 120, fill: "#C13333" });
      const label = text("label", "PEGO", { x: 20, y: 20, fill: "#FFFFFF", fontSize: 48 });
      return [
        frame(
          "page",
          { width: 800, height: 400, fill: "#FFFFFF" },
          redFirst ? [red, label] : [label, red],
        ),
      ];
    };
    expect(contrastIssues(page(true))).toEqual([]);
    // A shape drawn above the text does not count as its background.
    expect(contrastIssues(page(false)).map((issue) => issue.nodeId)).toEqual(["label"]);
  });

  test("shapes that only partly cover the text are ignored", () => {
    const issues = contrastIssues([
      frame("page", { width: 800, height: 400, fill: "#FFFFFF" }, [
        rect("chip", { x: 0, y: 0, width: 30, height: 30, fill: "#000000" }),
        text("label", "Readable?", { x: 10, y: 10, fill: "#FFFFFF" }),
      ]),
    ]);
    expect(issues.map((issue) => issue.nodeId)).toEqual(["label"]);
  });
});
