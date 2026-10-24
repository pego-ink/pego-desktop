import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdatePrefs } from "@/update-prefs";

describe("createUpdatePrefs", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });
  const fresh = async () => {
    dir = await mkdtemp(join(tmpdir(), "pego-prefs-"));
    return join(dir, "nested", "preferences.json");
  };

  test("no file means no preference", async () => {
    expect(await createUpdatePrefs(await fresh()).readChannel()).toBeNull();
  });

  test("writes and reads the channel, creating the folder", async () => {
    const file = await fresh();
    const prefs = createUpdatePrefs(file);
    await prefs.writeChannel("nightly");
    expect(await prefs.readChannel()).toBe("nightly");
    await prefs.writeChannel("stable");
    expect(await prefs.readChannel()).toBe("stable");
  });

  test("keeps other keys and ignores bad values and corrupt files", async () => {
    const file = await fresh();
    const prefs = createUpdatePrefs(file);
    await prefs.writeChannel("nightly");
    await writeFile(file, JSON.stringify({ other: 1, updateChannel: "beta" }));
    expect(await prefs.readChannel()).toBeNull();
    await prefs.writeChannel("stable");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ other: 1, updateChannel: "stable" });
    await writeFile(file, "{not json");
    expect(await prefs.readChannel()).toBeNull();
    await prefs.writeChannel("nightly");
    expect(await prefs.readChannel()).toBe("nightly");
  });
});
