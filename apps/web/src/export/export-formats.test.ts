import { describe, expect, test } from "bun:test";
import {
  codeFileName,
  exportBaseName,
  imageFileName,
  isCodeFormat,
  joinFilesForCopy,
  mimeFor,
  pngScale,
} from "./export-formats";

describe("export formats", () => {
  test("recognises code formats and png scales", () => {
    expect(isCodeFormat("react-tailwind")).toBe(true);
    expect(isCodeFormat("svg")).toBe(false);
    expect(pngScale("png-3x")).toBe(3);
    expect(pngScale("svg")).toBeUndefined();
  });

  test("file names", () => {
    expect(exportBaseName({ name: "Hero Board!", type: "frame" })).toBe("hero-board");
    expect(exportBaseName({ type: "frame" })).toBe("frame");
    expect(imageFileName("board", "png-1x")).toBe("board.png");
    expect(imageFileName("board", "png-2x")).toBe("board@2x.png");
    expect(imageFileName("board", "svg")).toBe("board.svg");
    expect(codeFileName("components/Page.tsx")).toBe("Page.tsx");
    expect(mimeFor("a.css")).toBe("text/css");
    expect(mimeFor("a.xyz")).toBe("text/plain");
  });

  test("copy text puts a header over each file when there are several", () => {
    expect(joinFilesForCopy([{ path: "a.html", contents: "x" }])).toBe("x");
    expect(
      joinFilesForCopy([
        { path: "a.tsx", contents: "A" },
        { path: "b.css", contents: "B" },
      ]),
    ).toBe("/* a.tsx */\nA\n/* b.css */\nB");
  });
});
