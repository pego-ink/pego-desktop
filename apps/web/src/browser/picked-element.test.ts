import { describe, expect, test } from "bun:test";
import { ELEMENT_PATH_SOURCE, parsePicked } from "./picked-element";

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
    ).toEqual({ tag: "button", selector: "main > button", label: "button.cta · Get started" });
    expect(parsePicked({ tag: "div", id: "hero", text: "", selector: "#hero" })?.label).toBe(
      "div#hero",
    );
    expect(parsePicked({ tag: "div" })).toBeNull();
    expect(parsePicked("picked")).toBeNull();
  });
});
