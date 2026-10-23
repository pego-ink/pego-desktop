/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { findNode } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { resetLiveDocument } from "@/workspace/test-reset";
import { useWorkspaceStore } from "@/workspace/use-workspace-store";
import { besideContent, importCaptureFromBridge } from "./extension-import";

const page = { url: "https://ayam.test/menu", title: "Menu Ayam" };
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

beforeEach(() => resetLiveDocument());

const selected = () => {
  const { doc, selection } = useDocumentStore.getState();
  return selection[0] ? findNode(doc, selection[0]) : null;
};

describe("browser extension imports", () => {
  test("an import goes right of the shown page's content", () => {
    expect(besideContent({ x: 0, y: 40, width: 800, height: 600 })).toEqual({ x: 920, y: 40 });
    expect(besideContent(null)).toEqual({ x: 0, y: 0 });
  });

  test("a screenshot becomes an image layer beside the content, selected, with its page", async () => {
    const outcome = await importCaptureFromBridge({
      kind: "screenshot",
      page,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: 1280,
      height: 720,
    });
    expect(outcome).toEqual({ content: 'Added a screenshot of "Menu Ayam".', isError: false });
    expect(selected()).toMatchObject({
      type: "image",
      name: "Screenshot · Menu Ayam",
      source: { url: page.url },
      width: 1280,
      height: 720,
      x: 920, // the sample frame is 800 wide at x 0
    });
  });

  test("a page snapshot becomes editable layers named after the page", async () => {
    // No font catalog: other suites expect it unloaded (it is module-wide state).
    const outcome = await importCaptureFromBridge(
      {
        kind: "snapshot",
        page,
        fullPage: true,
        snapshot: {
          url: page.url,
          title: page.title,
          root: {
            kind: "element",
            tag: "body",
            box: box(0, 0, 400, 300),
            style: { backgroundColor: "rgb(255, 255, 255)" },
            children: [{ kind: "text", text: "Ayam pop", box: box(20, 20, 120, 24), style: {} }],
          },
        },
      },
      { primeFonts: async () => undefined },
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toMatch(/^Imported "Menu Ayam" as \d+ layers/);
    expect(selected()).toMatchObject({ type: "frame", name: "Menu Ayam" });
  });

  test("bad input and no open document are refused", async () => {
    expect((await importCaptureFromBridge({ kind: "html", page })).isError).toBe(true);
    expect(
      (
        await importCaptureFromBridge({
          kind: "screenshot",
          page,
          dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
          width: 1,
          height: 1,
        })
      ).content,
    ).toBe("The screenshot is not an image.");
    useWorkspaceStore.setState({ liveId: null });
    expect((await importCaptureFromBridge({ kind: "screenshot", page })).content).toMatch(
      /Open a document/,
    );
  });
});
