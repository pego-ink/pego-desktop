/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { mentionToken } from "@pego/agent";
import { sampleDoc } from "@pego/doc";
import { buildRunPrompt } from "./run-prompt";

describe("buildRunPrompt", () => {
  test("mentions become labels in the request and lines in the context block", () => {
    const run = buildRunPrompt(sampleDoc, {
      text: `make ${mentionToken(0)} dark`,
      mentions: [{ kind: "layer", ids: ["frame-1"] }],
    });
    expect(run.requestText).toBe('make "Frame" [layer frame-1] dark');
    expect(run.context).toContain('- frame-1: "Frame" (frame)');
    expect(run.agentText).toBe(`${run.context}\n\nRequest: ${run.requestText}`);
    expect(run.displayText).toBe("make @Frame dark");
    expect(run.parts[1]).toEqual({
      kind: "mention",
      mention: "layer",
      label: "Frame",
      nodeType: "frame",
    });
  });

  test("a layer mentioned twice is listed once", () => {
    const run = buildRunPrompt(sampleDoc, {
      text: `fix ${mentionToken(0)} and ${mentionToken(1)}`,
      mentions: [
        { kind: "layer", ids: ["rect-1", "text-1"] },
        { kind: "layer", ids: ["rect-1"] },
      ],
    });
    expect(run.context.match(/^- /gm)).toHaveLength(2);
    expect(run.context).toStartWith("The request is about these 2 layers");
  });

  test("plain text is sent as it is", () => {
    const run = buildRunPrompt(sampleDoc, { text: "a landing page", mentions: [] });
    expect(run).toMatchObject({
      requestText: "a landing page",
      context: "",
      agentText: "a landing page",
    });
  });

  test("broken mentions are not sent; skill and style mentions fill the slots", () => {
    const run = buildRunPrompt(sampleDoc, {
      text: `${mentionToken(0)} in ${mentionToken(1)} as ${mentionToken(2)}`,
      mentions: [
        { kind: "layer", ids: ["deleted"] },
        { kind: "style", id: "bauhaus" },
        { kind: "skill", id: "landing-page" },
      ],
    });
    expect(run.context).toBe("");
    expect(run.requestText).toBe(
      'in "Bauhaus" [style bauhaus] as "Landing page" [skill landing-page]',
    );
    expect(run).toMatchObject({ skillId: "landing-page", styleId: "bauhaus" });
  });
});
