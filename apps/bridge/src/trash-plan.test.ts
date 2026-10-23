import { describe, expect, test } from "bun:test";
import {
  encodeTrashPath,
  isDirectChild,
  timestampSuffix,
  trashCommand,
  trashInfoContent,
  trashName,
  WINDOWS_TRASH_ENV,
} from "./trash-plan";

const date = new Date(2026, 9, 23, 7, 5, 9);

describe("trash plan", () => {
  test("isDirectChild accepts only a folder right inside the root", () => {
    expect(isDirectChild("/r/design", "/r/design/app")).toBe(true);
    expect(isDirectChild("/r/design", "/r/design")).toBe(false);
    expect(isDirectChild("/r/design", "/r/design/app/sub")).toBe(false);
    expect(isDirectChild("/r/design", "/r")).toBe(false);
    expect(isDirectChild("/r/design", "/r/other")).toBe(false);
    expect(isDirectChild("/r/design", "/r/design/../x")).toBe(false);
  });

  test("trashName appends a timestamp, then a counter, only when taken", () => {
    expect(timestampSuffix(date)).toBe("20261023-070509");
    expect(trashName("app", () => false, date)).toBe("app");
    expect(trashName("app", (n) => n === "app", date)).toBe("app 20261023-070509");
    const taken = new Set(["app", "app 20261023-070509"]);
    expect(trashName("app", (n) => taken.has(n), date)).toBe("app 20261023-070509 2");
  });

  test("trashinfo percent-encodes the path and stamps the date", () => {
    expect(encodeTrashPath("/home/a b/ü/x(1)")).toBe("/home/a%20b/%C3%BC/x%281%29");
    expect(trashInfoContent("/home/a b/design/app", date)).toBe(
      "[Trash Info]\nPath=/home/a%20b/design/app\nDeletionDate=2026-10-23T07:05:09\n",
    );
  });

  test("commands per OS never interpolate the path", () => {
    const evil = "/tmp/x'; Remove-Item -Recurse C:\\ #";
    const win = trashCommand("win32", evil)!;
    expect(win.cmd.join(" ")).not.toContain(evil);
    expect(win.cmd.join(" ")).toContain("SendToRecycleBin");
    expect(win.env).toEqual({ [WINDOWS_TRASH_ENV]: evil });
    expect(trashCommand("linux", "/a/b")).toEqual({ cmd: ["gio", "trash", "--", "/a/b"], env: {} });
    expect(trashCommand("darwin", "/a/b")).toBeNull();
  });
});
