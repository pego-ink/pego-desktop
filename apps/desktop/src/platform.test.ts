import { expect, test } from "bun:test";
import { bridgeBinaryName, bridgeSearchPath } from "@/platform";

test("bridge binary gets .exe on Windows only", () => {
  expect(bridgeBinaryName("win32")).toBe("pego-bridge.exe");
  expect(bridgeBinaryName("linux")).toBe("pego-bridge");
  expect(bridgeBinaryName("darwin")).toBe("pego-bridge");
});

test("search path adds the usual claude/bun folders per platform, without duplicates", () => {
  expect(bridgeSearchPath("darwin", "/Users/a", { PATH: "/usr/bin:/usr/local/bin" })).toBe(
    "/Users/a/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin",
  );
  expect(bridgeSearchPath("linux", "/home/a", { PATH: "/usr/bin" })).toBe(
    "/home/a/.local/bin:/home/a/.bun/bin:/usr/local/bin:/usr/bin",
  );
  expect(
    bridgeSearchPath("win32", "C:\\Users\\a", {
      APPDATA: "C:\\Users\\a\\AppData\\Roaming",
      Path: "C:\\Windows",
    }),
  ).toBe(
    "C:\\Users\\a\\AppData\\Roaming\\npm;C:\\Users\\a\\.local\\bin;C:\\Users\\a\\.bun\\bin;C:\\Windows",
  );
});
