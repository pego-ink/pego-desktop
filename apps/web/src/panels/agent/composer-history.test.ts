import { describe, expect, test } from "bun:test";
import type { AgentLogEntry } from "@/agent/use-agent-store";
import { textToComposer } from "@/panels/agent/mentions/composer-doc";
import { NO_HISTORY_NAV, historyFor, recordSent, stepHistory } from "./composer-history";

const user = (text: string): AgentLogEntry => ({ id: text, at: 0, kind: "user", text });
const reply = (text: string): AgentLogEntry => ({ id: `r${text}`, at: 0, kind: "assistant", text });

describe("historyFor", () => {
  test("user messages of the log, oldest first, repeats in a row once", () => {
    const log = [user("one"), reply("ok"), user("two"), user("two"), reply("ok"), user("three")];
    expect(historyFor("s1", log)).toEqual(["one", "two", "three"].map(textToComposer));
  });

  test("a message sent from this box comes back as typed, chips included", () => {
    const typed = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { ref: '{"kind":"layer","ids":["f1"]}', label: "Frame" } },
            { type: "text", text: " make it blue" },
          ],
        },
      ],
    };
    recordSent("s2", "@Frame make it blue", typed);
    const history = historyFor("s2", [user("hello"), user("@Frame make it blue")]);
    expect(history).toEqual([textToComposer("hello"), typed]);
  });
});

describe("stepHistory", () => {
  const entries = ["a", "b", "c"].map(textToComposer);
  const draft = textToComposer("my draft");

  test("up walks to older messages and stops at the oldest", () => {
    let step = stepHistory(entries, NO_HISTORY_NAV, draft, -1)!;
    expect(step.show).toEqual(entries[2]!);
    expect(step.nav).toEqual({ index: 2, draft });
    step = stepHistory(entries, step.nav, step.show, -1)!;
    step = stepHistory(entries, step.nav, step.show, -1)!;
    expect(step.show).toEqual(entries[0]!);
    expect(stepHistory(entries, step.nav, step.show, -1)).toBeNull();
  });

  test("down walks back and past the newest restores the draft", () => {
    const up = stepHistory(entries, NO_HISTORY_NAV, draft, -1)!;
    const older = stepHistory(entries, up.nav, up.show, -1)!;
    const newer = stepHistory(entries, older.nav, older.show, 1)!;
    expect(newer.show).toEqual(entries[2]!);
    const back = stepHistory(entries, newer.nav, newer.show, 1)!;
    expect(back).toEqual({ nav: NO_HISTORY_NAV, show: draft });
  });

  test("keys do their normal thing outside the history", () => {
    expect(stepHistory([], NO_HISTORY_NAV, draft, -1)).toBeNull();
    expect(stepHistory(entries, NO_HISTORY_NAV, draft, 1)).toBeNull();
  });
});
