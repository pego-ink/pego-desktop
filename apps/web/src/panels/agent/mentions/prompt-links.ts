import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type FoundLink = { from: number; to: number; href: string };

/** http(s) URLs, without the punctuation that usually ends the sentence around them. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;

/** The web links in a piece of text, with their offsets. */
export const findLinks = (text: string): FoundLink[] =>
  [...text.matchAll(URL_PATTERN)].map((match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
    href: match[0],
  }));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const decorate = (doc: ProseNode): DecorationSet => {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const link of findLinks(node.text)) {
      decorations.push(
        Decoration.inline(pos + link.from, pos + link.to, {
          class: "pego-prompt-link",
          "data-href": link.href,
          title: `${isMac ? "⌘" : "Ctrl"}-click to open ${link.href}`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
};

const key = new PluginKey<DecorationSet>("promptLinks");

/**
 * Web links in the prompt are underlined; ⌘/Ctrl-click opens one (in the system browser in the
 * desktop app). A plain click just places the caret, so the link stays editable text.
 */
export const PromptLinks = Extension.create({
  name: "promptLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            // On mousedown, before the browser moves the caret into the link.
            mousedown: (_view, event) => {
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
              const target = event.target instanceof Element ? event.target : null;
              const href = target?.closest<HTMLElement>(".pego-prompt-link")?.dataset.href;
              if (!href) return false;
              event.preventDefault();
              window.open(href, "_blank", "noopener,noreferrer");
              return true;
            },
          },
        },
      }),
    ];
  },
});
