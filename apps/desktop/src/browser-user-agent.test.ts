import { expect, test } from "bun:test";
import { browserUserAgent } from "@/browser-user-agent";

test("the built-in browser sends a plain Chrome user agent", () => {
  expect(
    browserUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Pego/0.1.0-beta Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36",
    ),
  ).toBe(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36",
  );
});

test("an agent without those parts is left as it is", () => {
  const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
  expect(browserUserAgent(chrome)).toBe(chrome);
});
