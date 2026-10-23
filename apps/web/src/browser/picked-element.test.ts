import { describe, expect, test } from "bun:test";
import {
  COMPONENT_NAMES_SOURCE,
  ELEMENT_PATH_SOURCE,
  parsePicked,
  withComponents,
} from "./picked-element";

/** The slice of a DOM element the page-side function walks. */
type PathElement = {
  tagName: string;
  id: string;
  parentElement: PathElement | null;
  children: PathElement[];
};

/** The exact source the picker script inlines. */
const elementPath = new Function(`return (${ELEMENT_PATH_SOURCE})`)() as (
  el: PathElement,
  escape: (value: string) => string,
  isUnique: (selector: string) => boolean,
) => string;

/** A tiny element tree: html > body > (main#app > div, div > button) */
const el = (tagName: string, id = "", children: PathElement[] = []): PathElement => {
  const node: PathElement = { tagName, id, parentElement: null, children };
  for (const child of children) child.parentElement = node;
  return node;
};
const button = el("BUTTON");
const second = el("DIV", "", [button]);
const first = el("DIV");
const app = el("MAIN", "app", [first, second]);
el("HTML", "", [el("BODY", "", [app])]);

const escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");

describe("picked element", () => {
  test("the path starts at the nearest unique id and numbers same-tag siblings", () => {
    expect(elementPath(button, escape, (s) => s === "#app")).toBe(
      "#app > div:nth-of-type(2) > button",
    );
    expect(elementPath(app, escape, () => true)).toBe("#app");
  });

  test("without a unique id the path starts at body", () => {
    expect(elementPath(button, escape, () => false)).toBe(
      "body > main > div:nth-of-type(2) > button",
    );
  });

  test("labels read tag, id or class, and the text; bad messages are ignored", () => {
    expect(
      parsePicked({ tag: "button", cls: "cta", text: "Get started", selector: "main > button" }),
    ).toEqual({
      tag: "button",
      selector: "main > button",
      label: "button.cta · Get started",
      path: [],
      text: "Get started",
    });
    expect(parsePicked({ tag: "div", id: "hero", text: "", selector: "#hero" })?.label).toBe(
      "div#hero",
    );
    expect(parsePicked({ tag: "div" })).toBeNull();
    expect(parsePicked("picked")).toBeNull();
  });

  test("the path becomes crumbs; component names start a crumb's badge and name the element", () => {
    const picked = parsePicked({
      tag: "button",
      cls: "cta",
      text: "Go",
      selector: "#app > div > button",
      path: [
        { tag: "body", selector: "body" },
        { tag: "div", id: "app", selector: "#app" },
        { tag: "div", cls: "card", selector: "#app > div" },
        { tag: "button", cls: "cta", selector: "#app > div > button" },
      ],
    })!;
    expect(picked.path.map((crumb) => crumb.label)).toEqual([
      "body",
      "div#app",
      "div.card",
      "button.cta",
    ]);
    const named = withComponents(picked, [null, "App", "Card", "Card"]);
    expect(named.path.map((crumb) => crumb.component)).toEqual([
      undefined,
      "App",
      "Card",
      undefined,
    ]);
    expect(named).toMatchObject({ component: "Card", label: "Card · button.cta" });
    // Names that do not line up with the path are ignored.
    expect(withComponents(picked, ["App"])).toBe(picked);
  });
});

describe("component names in the page", () => {
  type FakeNode = {
    nodeType: number;
    parentElement: FakeNode | null;
    [key: string]: unknown;
  };
  /** html > body > div (React fiber: div -> Card -> ThemeProvider -> App) */
  const html: FakeNode = { nodeType: 1, parentElement: null };
  const body: FakeNode = { nodeType: 1, parentElement: html };
  const fiber = {
    type: "div",
    return: {
      type: { name: "Card" },
      return: { type: { name: "ThemeProvider" }, return: { type: { name: "App" } } },
    },
  };
  const div: FakeNode = { nodeType: 1, parentElement: body, __reactFiber$x1: fiber };
  const vueSpan: FakeNode = {
    nodeType: 1,
    parentElement: body,
    __vueParentComponent: { type: { __name: "PriceTag" }, parent: null },
  };

  const names = (el: FakeNode): unknown => {
    const run = new Function("document", `return (${COMPONENT_NAMES_SOURCE})`)({
      documentElement: html,
    }) as (el: FakeNode) => unknown;
    return run(el);
  };

  test("React and Vue names, wrappers skipped, aligned with the path from body", () => {
    expect(names(div)).toEqual([null, "Card"]);
    expect(names(vueSpan)).toEqual([null, "PriceTag"]);
    const providerOnly: FakeNode = {
      nodeType: 1,
      parentElement: body,
      __reactFiber$x2: { type: "p", return: { type: { name: "ThemeProvider" } } },
    };
    expect(names(providerOnly)).toEqual([null, null]);
  });
});
