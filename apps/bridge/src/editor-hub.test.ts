import { describe, expect, test } from "bun:test";
import { createEditorHub, type EditorSocket } from "./editor-hub";

const socket = (): EditorSocket => ({ send: () => undefined, close: () => undefined });

describe("claimFile", () => {
  test("the most recently focused editor wins a shared file", () => {
    const hub = createEditorHub({ toolTimeoutMs: 1000 });
    const a = socket();
    const b = socket();
    hub.attach(a, "A");
    hub.attach(b, "B");
    expect(hub.claimFile("/p/project.pego", b)).toBe(true);
    // a was focused before b saved: a may not overwrite b's save.
    expect(hub.claimFile("/p/project.pego", a)).toBe(false);
    hub.focus(a);
    expect(hub.claimFile("/p/project.pego", a)).toBe(true);
    expect(hub.claimFile("/p/project.pego", b)).toBe(false);
    // Different files never block each other.
    expect(hub.claimFile("/q/project.pego", b)).toBe(true);
  });

  test("a disconnected writer releases its files", () => {
    const hub = createEditorHub({ toolTimeoutMs: 1000 });
    const a = socket();
    const b = socket();
    hub.attach(a, "A");
    hub.attach(b, "B");
    expect(hub.claimFile("/p/project.pego", b)).toBe(true);
    hub.detach(b);
    expect(hub.claimFile("/p/project.pego", a)).toBe(true);
  });
});
