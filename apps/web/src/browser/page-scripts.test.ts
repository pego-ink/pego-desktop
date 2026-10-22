import { describe, expect, test } from "bun:test";
import type { BrowserTarget } from "@pego/agent";
import {
  COLOR_HELPERS,
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
    expect(compiles(pickerStartScript)).not.toThrow();
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
