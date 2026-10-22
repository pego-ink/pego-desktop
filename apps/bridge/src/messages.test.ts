import { describe, expect, test } from "bun:test";
import { RUN_ATTACHMENT_LIMITS, type RunAttachmentType } from "@pego/agent";
import { imageBytes, makeAttachment } from "./agents/fixtures/images";
import { MAX_WS_MESSAGE_BYTES } from "./config";
import { parseEditorMessage } from "./messages";

const ok = (value: unknown) => parseEditorMessage(JSON.stringify(value));

describe("parseEditorMessage", () => {
  test("accepts every valid message type", () => {
    expect(ok({ type: "hello", protocol: 1, documentName: "a" }).ok).toBe(true);
    expect(ok({ type: "tool_result", callId: "c1", content: "x", isError: false }).ok).toBe(true);
    expect(ok({ type: "run_start", runId: "r1", prompt: "hi", agentId: "codex" }).ok).toBe(true);
    expect(
      ok({
        type: "run_start",
        runId: "r1",
        prompt: "hi",
        agentId: "opencode",
        model: "aki/cbai/deepseek-v4.1-flash(high)",
      }).ok,
    ).toBe(true);
    expect(ok({ type: "agents_refresh" }).ok).toBe(true);
    expect(ok({ type: "models_request", agentId: "gemini" }).ok).toBe(true);
    expect(ok({ type: "run_cancel", runId: "r1" }).ok).toBe(true);
  });
  test("rejects bad shapes", () => {
    expect(ok({ type: "hello", protocol: "1", documentName: "a" }).ok).toBe(false);
    expect(ok({ type: "tool_result", callId: "", content: "x", isError: false }).ok).toBe(false);
    expect(ok({ type: "tool_result", callId: "c", content: 1, isError: false }).ok).toBe(false);
    expect(ok({ type: "run_start", runId: "r", prompt: "", agentId: "codex" }).ok).toBe(false);
    expect(ok({ type: "run_start", runId: "r", prompt: "hi" }).ok).toBe(false);
    expect(ok({ type: "run_start", runId: "r", prompt: "hi", agentId: "vim" }).ok).toBe(false);
    expect(ok({ type: "models_request", agentId: "vim" }).ok).toBe(false);
    for (const model of ["--yolo", "a\nb", "", "x".repeat(201)]) {
      expect(ok({ type: "run_start", runId: "r", prompt: "hi", agentId: "codex", model }).ok).toBe(
        false,
      );
    }
    expect(ok({ type: "nope" }).ok).toBe(false);
    expect(ok(null).ok).toBe(false);
    expect(ok("str").ok).toBe(false);
  });
  test("rejects invalid JSON and binary", () => {
    expect(parseEditorMessage("{not json").ok).toBe(false);
    expect(parseEditorMessage(Buffer.from("{}")).ok).toBe(false);
  });

  describe("tool_result images", () => {
    const png = { mediaType: "image/png", data: "iVBORw0KGgo=", width: 10, height: 10 };
    const result = (images: unknown) =>
      ok({ type: "tool_result", callId: "c", content: "x", isError: false, images });

    test("accepts good images and empty list", () => {
      expect(result([png]).ok).toBe(true);
      expect(result([]).ok).toBe(true);
      expect(result([png, png, png, png]).ok).toBe(true);
    });
    test("rejects bad base64, media type and dimensions", () => {
      expect(result([{ ...png, data: "***" }]).ok).toBe(false);
      expect(result([{ ...png, data: "abc" }]).ok).toBe(false);
      expect(result([{ ...png, data: "data:image/png;base64,AAAA" }]).ok).toBe(false);
      expect(result([{ ...png, mediaType: "image/gif" }]).ok).toBe(false);
      expect(result([{ ...png, width: 0 }]).ok).toBe(false);
      expect(result([{ ...png, height: 1.5 }]).ok).toBe(false);
    });
    test("rejects more than 4 images", () => {
      expect(result([png, png, png, png, png]).ok).toBe(false);
    });
    test("rejects more than 8MB of image bytes in total", () => {
      const big = { ...png, data: "A".repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3 / 4) * 4) };
      expect(result([big]).ok).toBe(true);
      expect(result([big, big]).ok).toBe(false);
    });
  });
});

describe("run_start attachments", () => {
  const start = (attachments: unknown) =>
    ok({ type: "run_start", runId: "r", prompt: "hi", agentId: "claude-code", attachments });
  const parsed = (attachments: unknown) => {
    const result = start(attachments);
    return result.ok && result.message.type === "run_start"
      ? result.message.attachments
      : undefined;
  };

  test("accepts every allowed type, with and without dimensions", () => {
    const types: RunAttachmentType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const items = types.map((type, index) =>
      makeAttachment(`att-${index + 1}`, type, index === 0 ? { width: 64, height: 32 } : {}),
    );
    expect(start(items).ok).toBe(true);
    expect(start([]).ok).toBe(true);
    expect(ok({ type: "run_start", runId: "r", prompt: "hi", agentId: "codex" }).ok).toBe(true);
  });

  test("rejects other media types", () => {
    for (const mediaType of ["image/svg+xml", "text/html", "application/pdf", "image/bmp", ""]) {
      expect(
        start([makeAttachment("att-1", "image/png", { mediaType: mediaType as never })]).ok,
      ).toBe(false);
    }
  });

  test("rejects bad base64 (data: prefix, wrong padding, junk, whitespace)", () => {
    const good = makeAttachment().data;
    for (const data of [
      `data:image/png;base64,${good}`,
      good.slice(0, -1),
      `${good.slice(0, 8)}!!${good.slice(10)}`,
      `${good.slice(0, 8)}\n${good.slice(9)}`,
      "====",
      "",
    ]) {
      expect(start([makeAttachment("att-1", "image/png", { data })]).ok).toBe(false);
    }
  });

  test("rejects bytes that are not the declared image type", () => {
    const jpegAsPng = imageBytes("image/jpeg", 16).toString("base64");
    expect(start([makeAttachment("att-1", "image/png", { data: jpegAsPng })]).ok).toBe(false);
    const text = Buffer.from("<script>alert(1)</script>").toString("base64");
    expect(start([makeAttachment("att-1", "image/png", { data: text })]).ok).toBe(false);
    const riffNotWebp = Buffer.from("RIFF....WAVEfmt ").toString("base64");
    expect(start([makeAttachment("att-1", "image/webp", { data: riffNotWebp })]).ok).toBe(false);
  });

  test("decoded size is capped at maxBytes", () => {
    const atLimit = imageBytes("image/png", RUN_ATTACHMENT_LIMITS.maxBytes - 12);
    expect(atLimit.length).toBe(RUN_ATTACHMENT_LIMITS.maxBytes);
    expect(
      start([makeAttachment("att-1", "image/png", { data: atLimit.toString("base64") })]).ok,
    ).toBe(true);
    const over = imageBytes("image/png", RUN_ATTACHMENT_LIMITS.maxBytes - 11);
    expect(
      start([makeAttachment("att-1", "image/png", { data: over.toString("base64") })]).ok,
    ).toBe(false);
  });

  test("count is capped at maxCount and ids must be unique", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, index) => makeAttachment(`att-${index + 1}`));
    expect(start(many(RUN_ATTACHMENT_LIMITS.maxCount)).ok).toBe(true);
    expect(start(many(RUN_ATTACHMENT_LIMITS.maxCount + 1)).ok).toBe(false);
    expect(start([makeAttachment("att-1"), makeAttachment("att-1")]).ok).toBe(false);
  });

  test("ids must look like att-<n>", () => {
    for (const id of [
      "att-",
      "att-x",
      "att-1/../x",
      "../att-1",
      "ATT-1",
      "att-1 ",
      "x".repeat(40),
      "",
    ]) {
      expect(start([makeAttachment(id)]).ok).toBe(false);
    }
  });

  test("names are reduced to a safe display name", () => {
    const name = (raw: string) =>
      parsed([makeAttachment("att-1", "image/png", { name: raw })])?.[0]?.name;
    expect(name("../../etc/passwd")).toBe("passwd");
    expect(name("C:\\Users\\me\\shot.png")).toBe("shot.png");
    expect(name("a/b/")).toBe("image");
    expect(name("@secret.png")).toBe("secret.png");
    expect(name("evil\u0000\n<b>x.png")).toBe("evilbx.png");
    expect(name("")).toBe("image");
    expect(name("...")).toBe("image");
    expect(name(`${"n".repeat(300)}.png`)?.length).toBe(80);
  });

  test("the websocket frame cap fits the maximum attachments", () => {
    const base64PerImage = Math.ceil((RUN_ATTACHMENT_LIMITS.maxBytes * 4) / 3);
    const worst = base64PerImage * RUN_ATTACHMENT_LIMITS.maxCount + 100_000 + 4096;
    expect(MAX_WS_MESSAGE_BYTES).toBeGreaterThanOrEqual(worst);
    expect(MAX_WS_MESSAGE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});

describe("run_steer", () => {
  test("accepts text of 1..20000 chars", () => {
    expect(ok({ type: "run_steer", runId: "r", text: "go left" }).ok).toBe(true);
    expect(ok({ type: "run_steer", runId: "r", text: "x".repeat(20_000) }).ok).toBe(true);
  });

  test("rejects empty or oversized text, missing run id", () => {
    expect(ok({ type: "run_steer", runId: "r", text: "" }).ok).toBe(false);
    expect(ok({ type: "run_steer", runId: "r", text: "x".repeat(20_001) }).ok).toBe(false);
    expect(ok({ type: "run_steer", text: "hi" }).ok).toBe(false);
  });

  test("attachments go through the same validation as run_start", () => {
    const good = makeAttachment("att-1", "image/png");
    expect(ok({ type: "run_steer", runId: "r", text: "hi", attachments: [good] }).ok).toBe(true);
    const bad = { ...good, mediaType: "image/jpeg" };
    expect(ok({ type: "run_steer", runId: "r", text: "hi", attachments: [bad] }).ok).toBe(false);
    const many = Array.from({ length: 7 }, (_, i) => makeAttachment(`att-${i + 1}`, "image/png"));
    expect(ok({ type: "run_steer", runId: "r", text: "hi", attachments: many }).ok).toBe(false);
  });
});
