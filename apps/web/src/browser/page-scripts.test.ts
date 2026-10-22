import { describe, expect, test } from "bun:test";
import type { BrowserTarget } from "@pego/agent";
import {
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
