import { describe, expect, test } from "bun:test";
import {
  baseVersion,
  expiredNightlyTags,
  nightlyReleases,
  nightlyVersion,
  planNightly,
} from "./nightly";

const sha = (n: number) => String(n).repeat(40).slice(0, 40);
const release = (tag: string, day: number, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  target_commitish: sha(day % 10),
  prerelease: true,
  draft: false,
  published_at: `2026-10-${String(day).padStart(2, "0")}T19:30:00Z`,
  ...extra,
});
const nightly = (day: number) =>
  release(`v0.1.0-nightly.202610${String(day).padStart(2, "0")}.${day}.1`, day);

describe("version", () => {
  test("strips the prerelease part", () => {
    expect(baseVersion("0.1.0-beta")).toBe("0.1.0");
    expect(baseVersion("1.2.3")).toBe("1.2.3");
    expect(baseVersion("1.2.3-nightly.1+abc")).toBe("1.2.3");
    expect(() => baseVersion("latest")).toThrow();
  });

  test("builds <base>-nightly.<date>.<run>", () => {
    expect(nightlyVersion("0.1.0-beta", "20261024", "17", "2")).toBe("0.1.0-nightly.20261024.17.2");
    expect(() => nightlyVersion("0.1.0", "2026-10-24", "1", "1")).toThrow();
    expect(() => nightlyVersion("0.1.0", "20261024", "0", "1")).toThrow();
    expect(() => nightlyVersion("0.1.0", "20261024", "1; rm", "1")).toThrow();
    expect(() => nightlyVersion("0.1.0", "20261024", "1", "0")).toThrow();
  });

  test("sorts newer than older nightlies and than the beta of the same base", () => {
    const gt = (a: string, b: string) => Bun.semver.order(a, b) === 1;
    const a = nightlyVersion("0.1.0-beta", "20261024", "9", "1");
    const a2 = nightlyVersion("0.1.0-beta", "20261024", "9", "2");
    const b = nightlyVersion("0.1.0-beta", "20261024", "10", "1");
    const c = nightlyVersion("0.1.0-beta", "20261101", "11", "1");
    expect(gt(a2, a)).toBe(true);
    expect(gt(b, a2)).toBe(true);
    expect(gt(c, b)).toBe(true);
    expect(gt(a, "0.1.0-beta")).toBe(true);
  });
});

describe("nightlyReleases", () => {
  test("keeps only published nightly prereleases, newest first, across pages", () => {
    const pages = [
      [
        nightly(3),
        release("v0.1.0", 20, { prerelease: false }),
        release("v0.1.0-beta", 21),
        nightly(1),
      ],
      [
        nightly(2),
        { ...nightly(9), draft: true },
        release("v0.1.0-nightly.1.1", 8),
        release("v0.1.0-nightly.20261008.8", 8),
      ],
    ];
    expect(nightlyReleases(pages).map((r) => r.tag)).toEqual([
      "v0.1.0-nightly.20261003.3.1",
      "v0.1.0-nightly.20261002.2.1",
      "v0.1.0-nightly.20261001.1.1",
    ]);
  });

  test("ignores junk", () => {
    expect(nightlyReleases(null)).toEqual([]);
    expect(nightlyReleases([null, 3, "x", {}])).toEqual([]);
  });
});

describe("planNightly", () => {
  test("builds when there is no nightly yet", () => {
    expect(planNightly(sha(1), [], false)).toEqual({
      build: true,
      previousTag: "",
      previousSha: "",
    });
  });

  test("skips when dev is at the newest nightly's commit", () => {
    const plan = planNightly(sha(3), [[nightly(2), nightly(3)]], false);
    expect(plan.build).toBe(false);
    expect(plan.previousTag).toBe("v0.1.0-nightly.20261003.3.1");
  });

  test("builds when dev moved, or when forced", () => {
    expect(planNightly(sha(5), [[nightly(3)]], false).build).toBe(true);
    expect(planNightly(sha(3), [[nightly(3)]], true).build).toBe(true);
  });

  test("a release whose target is not a full sha never counts as unchanged", () => {
    const odd = release("v0.1.0-nightly.20261003.3.1", 3, { target_commitish: "dev" });
    expect(planNightly(sha(3), [[odd]], false)).toMatchObject({ build: true, previousSha: "" });
  });
});

describe("expiredNightlyTags", () => {
  const all = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(nightly),
    [release("v0.1.0", 30, { prerelease: false })],
  ];

  test("keeps the newest N, never touches other releases", () => {
    expect(expiredNightlyTags(all, 7)).toEqual([
      "v0.1.0-nightly.20261002.2.1",
      "v0.1.0-nightly.20261001.1.1",
    ]);
    expect(expiredNightlyTags(all, 20)).toEqual([]);
  });

  test("deletes nothing while a draft or stable release is the only other thing", () => {
    expect(expiredNightlyTags([release("v0.1.0-beta", 1)], 7)).toEqual([]);
  });
});
