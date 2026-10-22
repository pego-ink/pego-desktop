/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  ensureWritePermission,
  queryWritePermission,
  requestWritePermission,
  writeToHandle,
} from "./file-permission";
import type { PegoFileHandle } from "./fs-access";

const fakeHandle = (opts: {
  query?: PermissionState | "throw" | "absent";
  request?: PermissionState | "throw" | "absent";
}) => {
  const calls = { query: 0, request: 0 };
  const writes: string[] = [];
  const handle: PegoFileHandle = {
    name: "doc.pego",
    getFile: async () => new File([], "doc.pego"),
    createWritable: async () => ({
      write: async (data) => void writes.push(String(data)),
      close: async () => void writes.push("<closed>"),
    }),
    ...(opts.query === "absent"
      ? {}
      : {
          queryPermission: async () => {
            calls.query += 1;
            if (opts.query === "throw") throw new Error("boom");
            return (opts.query ?? "granted") as PermissionState;
          },
        }),
    ...(opts.request === "absent"
      ? {}
      : {
          requestPermission: async () => {
            calls.request += 1;
            if (opts.request === "throw") throw new Error("boom");
            return (opts.request ?? "granted") as PermissionState;
          },
        }),
  };
  return { handle, calls, writes };
};

describe("write permission", () => {
  test("handles without the permission API count as granted", async () => {
    const { handle } = fakeHandle({ query: "absent", request: "absent" });
    expect(await queryWritePermission(handle)).toBe("granted");
    expect(await requestWritePermission(handle)).toBe("granted");
  });

  test("query reports prompt and denied without prompting", async () => {
    const prompt = fakeHandle({ query: "prompt" });
    expect(await queryWritePermission(prompt.handle)).toBe("prompt");
    expect(prompt.calls.request).toBe(0);
    expect(await queryWritePermission(fakeHandle({ query: "denied" }).handle)).toBe("denied");
  });

  test("a throwing query degrades to prompt, a throwing request to denied", async () => {
    expect(await queryWritePermission(fakeHandle({ query: "throw" }).handle)).toBe("prompt");
    expect(await requestWritePermission(fakeHandle({ request: "throw" }).handle)).toBe("denied");
  });

  test("ensure skips the prompt when already granted", async () => {
    const { handle, calls } = fakeHandle({ query: "granted" });
    expect(await ensureWritePermission(handle)).toBe(true);
    expect(calls.request).toBe(0);
  });

  test("ensure requests once when the state is prompt", async () => {
    const granted = fakeHandle({ query: "prompt", request: "granted" });
    expect(await ensureWritePermission(granted.handle)).toBe(true);
    expect(granted.calls.request).toBe(1);
    const denied = fakeHandle({ query: "prompt", request: "denied" });
    expect(await ensureWritePermission(denied.handle)).toBe(false);
  });

  test("writeToHandle writes then closes", async () => {
    const { handle, writes } = fakeHandle({});
    await writeToHandle(handle, "hello");
    expect(writes).toEqual(["hello", "<closed>"]);
  });
});
