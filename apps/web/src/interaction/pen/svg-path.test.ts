import { describe, expect, test } from "bun:test";
import { parseSvgPath, serializeContours } from "./svg-path";

describe("parseSvgPath", () => {
  test("absolute polyline", () => {
    const c = parseSvgPath("M0 0L10 0L10 10");
    expect(c).toHaveLength(1);
    expect(c?.[0]?.closed).toBe(false);
    expect(c?.[0]?.anchors.map((a) => a.p)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  test("relative commands equal absolute ones", () => {
    const rel = parseSvgPath("m10 10 l5 0 h5 v5 c1 1 2 2 3 3 z");
    const abs = parseSvgPath("M10 10L15 10L20 10L20 15C21 16 22 17 23 18Z");
    expect(rel).toEqual(abs);
  });

  test("implicit lineto after moveto and comma/space separators", () => {
    const c = parseSvgPath("M0,0 10,0 10,10");
    expect(c?.[0]?.anchors).toHaveLength(3);
  });

  test("cubic handles land on the right anchors", () => {
    const c = parseSvgPath("M0 0C0 10 10 10 10 0");
    const [a, b] = c?.[0]?.anchors ?? [];
    expect(a?.out).toEqual({ x: 0, y: 10 });
    expect(b?.in).toEqual({ x: 10, y: 10 });
    expect(a?.in).toBeNull();
  });

  test("quadratic converts to an equivalent cubic", () => {
    const c = parseSvgPath("M0 0Q15 30 30 0");
    const [a, b] = c?.[0]?.anchors ?? [];
    expect(a?.out?.x).toBeCloseTo(10);
    expect(a?.out?.y).toBeCloseTo(20);
    expect(b?.in?.x).toBeCloseTo(20);
    expect(b?.in?.y).toBeCloseTo(20);
  });

  test("S and T reflect the previous control point", () => {
    const s = parseSvgPath("M0 0C0 10 10 10 10 0S20 -10 20 0");
    expect(s?.[0]?.anchors[1]?.out).toEqual({ x: 10, y: -10 });
    const t = parseSvgPath("M0 0Q5 10 10 0T20 0");
    expect(t?.[0]?.anchors).toHaveLength(3);
    expect(t?.[0]?.anchors[1]?.out?.y).toBeCloseTo(-20 / 3);
  });

  test("Z closes and merges a duplicate end point", () => {
    const c = parseSvgPath("M0 0L10 0L10 10L0 0Z");
    expect(c?.[0]?.closed).toBe(true);
    expect(c?.[0]?.anchors).toHaveLength(3);
  });

  test("multiple subpaths", () => {
    const c = parseSvgPath("M0 0L5 5ZM20 20L30 30");
    expect(c).toHaveLength(2);
    expect(c?.[1]?.closed).toBe(false);
  });

  test("arc falls back to a line to its end point", () => {
    const c = parseSvgPath("M0 0A5 5 0 0 1 10 0");
    expect(c?.[0]?.anchors[1]?.p).toEqual({ x: 10, y: 0 });
  });

  test("malformed data returns null", () => {
    expect(parseSvgPath("")).toBeNull();
    expect(parseSvgPath("L10 10")).toBeNull();
    expect(parseSvgPath("M0 0L10")).toBeNull();
    expect(parseSvgPath("M0 0 foo")).toBeNull();
  });
});

describe("serializeContours", () => {
  test("writes absolute M/L/C/Z", () => {
    const c = parseSvgPath("M0 0L10 0C10 5 5 10 0 10Z");
    expect(serializeContours(c ?? [])).toBe("M0 0L10 0C10 5 5 10 0 10Z");
  });

  test("round trips through parse", () => {
    const sources = [
      "M0 0L10 20L30 5",
      "M1.5 2.25C3 4 5 6 7 8C9 10 11 12 13 14",
      "M0 0C0 10 10 10 10 0C10 -10 0 -10 0 0Z",
      "M0 0L5 5ZM20 20L30 30",
    ];
    for (const src of sources) {
      const first = parseSvgPath(src) ?? [];
      const out = serializeContours(first);
      expect(parseSvgPath(out)).toEqual(first);
      expect(serializeContours(parseSvgPath(out) ?? [])).toBe(out);
    }
  });

  test("closed contour with a curved closing segment keeps its handles", () => {
    const c = parseSvgPath("M0 0C0 10 10 10 10 0C10 -10 0 -10 0 0Z") ?? [];
    expect(c[0]?.anchors).toHaveLength(2);
    expect(c[0]?.anchors[0]?.in).toEqual({ x: 0, y: -10 });
  });

  test("no negative zero", () => {
    expect(
      serializeContours([
        {
          closed: false,
          anchors: [
            { p: { x: -0, y: 0 }, in: null, out: null },
            { p: { x: -0.0001, y: 1 }, in: null, out: null },
          ],
        },
      ]),
    ).toBe("M0 0L0 1");
  });
});
