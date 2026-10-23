/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { findLinks } from "./prompt-links";

describe("prompt links", () => {
  test("finds http(s) URLs and leaves the sentence's punctuation out", () => {
    expect(findLinks("copy https://pego.ink/pricing, then (http://localhost:3000/a?b=1).")).toEqual(
      [
        { from: 5, to: 29, href: "https://pego.ink/pricing" },
        { from: 37, to: 64, href: "http://localhost:3000/a?b=1" },
      ],
    );
    expect(findLinks("no links: pego.ink or ftp://x")).toEqual([]);
  });
});
