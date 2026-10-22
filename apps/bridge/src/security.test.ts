import { describe, expect, test } from "bun:test";
import { isHostAllowed, isOriginAllowed } from "@/security";

describe("isHostAllowed", () => {
  test("accepts loopback names on the bridge port", () => {
    expect(isHostAllowed("127.0.0.1:4519", 4519)).toBe(true);
    expect(isHostAllowed("localhost:4519", 4519)).toBe(true);
    expect(isHostAllowed("LOCALHOST:4519", 4519)).toBe(true);
  });
  test("rejects other hosts, ports and missing header", () => {
    expect(isHostAllowed("evil.example.com:4519", 4519)).toBe(false);
    expect(isHostAllowed("127.0.0.1:9999", 4519)).toBe(false);
    expect(isHostAllowed("127.0.0.1", 4519)).toBe(false);
    expect(isHostAllowed("localhost.evil.com:4519", 4519)).toBe(false);
    expect(isHostAllowed(null, 4519)).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  test("default allows any localhost port, rejects remote and missing origins", () => {
    expect(isOriginAllowed("http://localhost:5173", null)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5199", null)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", null)).toBe(false);
    expect(isOriginAllowed("http://localhost.evil.com", null)).toBe(false);
    expect(isOriginAllowed("null", null)).toBe(false);
    expect(isOriginAllowed("file://", null)).toBe(false);
    expect(isOriginAllowed(null, null)).toBe(false);
  });
  test("explicit allowlist is exact", () => {
    const allowed = ["https://pego.app"];
    expect(isOriginAllowed("https://pego.app", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(false);
  });
});
