import { describe, expect, test } from "bun:test";
import type { BrowserTarget } from "@pego/agent";
import {
  COLOR_HELPERS,
  PURE_HELPERS,
  boxScript,
  describeScript,
  pickerStartScript,
  pickerStopScript,
  snapshotScript,
  unwrapEvaluation,
} from "./page-scripts";

const targets: BrowserTarget[] = [
  { kind: "full-page" },
  { kind: "selection" },
  { kind: "query", selector: 'a[href="x"] > .it\'s "q"' },
];

const compiles = (expression: string) => () => new Function("return " + expression);

describe("page scripts", () => {
  test("every script is valid JavaScript", () => {
    for (const target of targets) {
      expect(compiles(snapshotScript(target))).not.toThrow();
      expect(compiles(describeScript(target))).not.toThrow();
      expect(compiles(boxScript(target))).not.toThrow();
    }
    expect(compiles(pickerStartScript("0123456789abcdef0123456789abcdef"))).not.toThrow();
    expect(compiles(pickerStopScript)).not.toThrow();
  });

  test("the selector is embedded as a JSON string", () => {
    expect(boxScript({ kind: "query", selector: 'a"b' })).toContain('"selector":"a\\"b"');
  });

  test("a script runs and reports errors as data", () => {
    // No DOM here: referencing `document` fails inside the script's own try/catch.
    const out = JSON.parse(String(new Function("return " + boxScript(targets[0]!))())) as {
      error?: string;
    };
    expect(typeof out.error).toBe("string");
  });
});

describe("color helpers", () => {
  // A fake 1x1 canvas that "resolves" any color to a fixed pixel.
  const load = (pixel: number[]) => {
    const ctx = {
      fillStyle: "#000000",
      clearRect: () => {},
      fillRect: () => {},
      getImageData: () => ({ data: pixel }),
    };
    let current = "#000000";
    Object.defineProperty(ctx, "fillStyle", {
      get: () => current,
      set: (v: string) => {
        if (!/\(/.test(v))
          current = v; // functional colors parse, junk is ignored
        else current = "#ffffff";
      },
    });
    const document = { createElement: () => ({ getContext: () => ctx }) };
    return new Function(
      "document",
      COLOR_HELPERS + "return {normColor:normColor,normColors:normColors}",
    )(document) as { normColor: (c: string) => string; normColors: (s: string) => string };
  };

  test("modern colors become rgb/rgba, keeping alpha", () => {
    expect(load([10, 20, 30, 255]).normColor("oklch(0.5 0.1 200)")).toBe("rgb(10, 20, 30)");
    expect(load([10, 20, 30, 128]).normColor("color(display-p3 1 0 0 / 0.5)")).toBe(
      "rgba(10, 20, 30, 0.502)",
    );
  });

  test("rgb colors pass through untouched", () => {
    expect(load([0, 0, 0, 255]).normColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  test("gradient and shadow strings are rewritten token by token", () => {
    const { normColors } = load([1, 2, 3, 255]);
    expect(normColors("linear-gradient(in oklab, oklch(0.5 0.1 20), rgb(0, 0, 0))")).toBe(
      "linear-gradient(rgb(1, 2, 3), rgb(0, 0, 0))",
    );
    expect(normColors("linear-gradient(to right in oklab, lab(50 1 1 / 0.5) 0%, red)")).toBe(
      "linear-gradient(to right, rgb(1, 2, 3) 0%, red)",
    );
    expect(normColors("oklab(0.5 0 0 / 0.3) 0px 4px 8px 0px")).toBe("rgb(1, 2, 3) 0px 4px 8px 0px");
  });
});

describe("unwrapEvaluation", () => {
  const ok = (value: unknown) => ({ result: { value: JSON.stringify(value) } });

  test("returns the ok payload", () => {
    expect(unwrapEvaluation(ok({ ok: { a: 1 } }))).toEqual({ a: 1 });
  });

  test("rejects with the script's error message", () => {
    expect(() => unwrapEvaluation(ok({ error: "No element matches .x" }))).toThrow(
      "No element matches .x",
    );
  });

  test("rejects with the exception message", () => {
    expect(() =>
      unwrapEvaluation({
        exceptionDetails: {
          text: "Uncaught",
          exception: { description: "SyntaxError: bad\n at x" },
        },
      }),
    ).toThrow("bad");
  });

  test("rejects when nothing came back", () => {
    expect(() => unwrapEvaluation({ result: {} })).toThrow("no result");
  });
});

describe("pure page helpers", () => {
  const h = new Function(
    PURE_HELPERS +
      "return {splitTop:splitTop,transformKind:transformKind,collapseText:collapseText}",
  )() as {
    splitTop: (s: string) => string[];
    transformKind: (t: string) => number;
    collapseText: (s: string, ws: string) => string;
  };

  test("splitTop splits at top-level commas only", () => {
    expect(h.splitTop("linear-gradient(red, blue), url(a.png)")).toEqual([
      "linear-gradient(red, blue)",
      " url(a.png)",
    ]);
    expect(h.splitTop("url(a.png)")).toHaveLength(1);
  });

  test("transformKind: none/identity 0, translate/scale 1, rotate/skew 2", () => {
    expect(h.transformKind("none")).toBe(0);
    expect(h.transformKind("matrix(1, 0, 0, 1, 0, 0)")).toBe(0);
    expect(h.transformKind("matrix(1, 0, 0, 1, 10, 0)")).toBe(1);
    expect(h.transformKind("matrix(2, 0, 0, 2, 0, 0)")).toBe(1);
    expect(h.transformKind("matrix(0.866, 0.5, -0.5, 0.866, 0, 0)")).toBe(2);
    expect(h.transformKind("matrix(1, 0, 0.5, 1, 0, 0)")).toBe(2);
    const identity3d = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
    expect(h.transformKind(identity3d)).toBe(0);
    expect(h.transformKind("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,5,0,0,1)")).toBe(1);
    expect(h.transformKind("matrix3d(1,0,0,0,0,1,0.3,0,0,0,1,0,0,0,0,1)")).toBe(2);
  });

  test("collapseText collapses like the browser and keeps <br> as newlines", () => {
    expect(h.collapseText("  Hello \n   world  ", "normal")).toBe("Hello world");
    expect(h.collapseText("one \u0001 two", "normal")).toBe("one\ntwo");
    expect(h.collapseText("a\u0001", "normal")).toBe("a");
    expect(h.collapseText("a\n  b", "pre")).toBe("a\n  b");
    expect(h.collapseText("a  b\n c", "pre-line")).toBe("a b\nc");
    expect(h.collapseText("a\u00a0\u00a0b", "normal")).toBe("a\u00a0\u00a0b");
  });
});
