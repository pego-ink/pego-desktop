import { describe, expect, test } from "bun:test";
import { buildChildEnv, extendPath, extraPathDirs, withApiKeys } from "./env";

describe("child env", () => {
  test("drops Anthropic/OpenAI key variables, keeps the rest, drops undefined values", () => {
    const env = buildChildEnv(
      {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "a",
        ANTHROPIC_AUTH_TOKEN: "b",
        OPENAI_API_KEY: "c",
        CODEX_API_KEY: "d",
        DEEPSEEK_API_KEY: "keep",
        EMPTY: undefined,
      },
      "/home/u",
    );
    expect(env).toEqual({
      PATH: `/usr/bin:${extraPathDirs("/home/u").join(":")}`,
      DEEPSEEK_API_KEY: "keep",
    });
  });

  test("extends PATH with the usual CLI locations without duplicating or reordering", () => {
    const dirs = extraPathDirs("/home/u");
    expect(dirs).toEqual([
      "/home/u/.local/bin",
      "/home/u/.opencode/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]);
    expect(extendPath("/opt/homebrew/bin:/bin", dirs)).toBe(
      "/opt/homebrew/bin:/bin:/home/u/.local/bin:/home/u/.opencode/bin:/usr/local/bin",
    );
    expect(extendPath(undefined, ["/x"])).toBe("/x");
  });

  test("withApiKeys restores keys for adapters that need them", () => {
    const env = withApiKeys(
      { PATH: "/bin" },
      { OPENAI_API_KEY: "c", ANTHROPIC_API_KEY: "a", OTHER: "x" },
    );
    expect(env).toEqual({ PATH: "/bin", OPENAI_API_KEY: "c", ANTHROPIC_API_KEY: "a" });
  });
});
