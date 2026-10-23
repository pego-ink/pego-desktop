import { Extension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { MentionRef } from "@pego/agent";
import { MENTION_NODE } from "./composer-doc";
import { MentionChipView } from "./MentionChipView";
import type { MentionItem } from "./mention-sources";

/** The open @ menu, as the composer renders it. */
export type MentionMenuState = {
  items: MentionItem[];
  /** Insert the chosen item as a chip in place of the typed "@query". */
  choose: (item: MentionItem) => void;
};

export type MentionMenuHooks = {
  /** Items for the typed query (after the @). */
  items: (query: string) => MentionItem[];
  /** The menu opened, changed (state) or closed (null). */
  onChange: (state: MentionMenuState | null) => void;
  /** Arrow keys, Enter, Tab and Escape while the menu is open; true when handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/** Attributes of a chip node for `ref`. */
export const chipContent = (ref: MentionRef, label: string) => ({
  type: MENTION_NODE,
  attrs: { ref: JSON.stringify(ref), label },
});

/**
 * Mention chips: an inline atom holding its ref as JSON (parsed by composer-doc.ts), drawn by
 * MentionChipView, typed with "@". The menu itself is rendered by the composer through `hooks`.
 */
export const createMentionExtension = (hooks: () => MentionMenuHooks) =>
  Mention.extend({
    addAttributes() {
      return {
        ref: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-ref"),
          renderHTML: (attrs: { ref?: string | null }) =>
            attrs.ref ? { "data-ref": attrs.ref } : {},
        },
        label: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-label") ?? "",
          renderHTML: (attrs: { label?: string }) => ({ "data-label": attrs.label ?? "" }),
        },
        /** Set on a chip that follows a live source (see live-chips.ts); null for a fixed chip. */
        live: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-live"),
          renderHTML: (attrs: { live?: string | null }) =>
            attrs.live ? { "data-live": attrs.live } : {},
        },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(MentionChipView, { as: "span" });
    },
  }).configure({
    renderText: ({ node }) => `@${String(node.attrs.label ?? "")}`,
    renderHTML: ({ node }) => [
      "span",
      { "data-type": MENTION_NODE },
      `@${String(node.attrs.label ?? "")}`,
    ],
    deleteTriggerWithBackspace: true,
    suggestion: {
      char: "@",
      allowSpaces: false,
      items: ({ query }) => hooks().items(query),
      command: ({ editor, range, props }) => {
        const item = props as unknown as MentionItem;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [chipContent(item.ref, item.title), { type: "text", text: " " }])
          .run();
      },
      render: () => {
        const open = (props: SuggestionProps<MentionItem>) =>
          hooks().onChange({
            items: props.items,
            choose: (item) => props.command(item as never),
          });
        return {
          onStart: open,
          onUpdate: open,
          onKeyDown: ({ event }: SuggestionKeyDownProps) => hooks().onKeyDown(event),
          onExit: () => hooks().onChange(null),
        };
      },
    },
  });

/**
 * Enter sends (or queues while the agent works), Cmd/Ctrl+Enter sends into the running agent now,
 * Shift+Enter breaks the line (StarterKit's hard break). Enter is left to the @ menu while it is
 * open, and to the input method while composing.
 */
export const createSubmitExtension = (
  hooks: () => { menuOpen: boolean; submit: (steer: boolean) => void },
) =>
  Extension.create({
    name: "submitOnEnter",
    // Ahead of StarterKit's hard break, which also binds Mod-Enter.
    priority: 1000,
    addKeyboardShortcuts() {
      const submit = (steer: boolean) => {
        if (hooks().menuOpen || this.editor.view.composing) return false;
        hooks().submit(steer);
        return true;
      };
      return {
        Enter: () => submit(false),
        "Mod-Enter": () => submit(true),
      };
    },
  });
