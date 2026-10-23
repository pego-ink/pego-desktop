import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { mentionTitle, skills, type MentionRef } from "@pego/agent";
import { cn } from "@pego/ui/lib/utils";
import { submitPrompt, steerNow } from "@/agent/queue";
import { buildRunPrompt } from "@/agent/run-prompt";
import { cancelRun } from "@/agent/run";
import { useAgentStore, useVisibleRun } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { AgentSelector } from "@/panels/agent/AgentSelector";
import { SkillChip } from "@/panels/agent/SkillChip";
import { AttachmentStrip } from "@/panels/agent/attachments/AttachmentStrip";
import { addAttachmentFiles } from "@/panels/agent/attachments/add-files";
import { ATTACH_ACCEPT, pastedImageFiles } from "@/panels/agent/attachments/attachment-utils";
import { useAttachmentDrop } from "@/panels/agent/attachments/use-attachment-drop";
import { isRunActive } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";
import { composerToPrompt, textToComposer } from "@/panels/agent/mentions/composer-doc";
import { liveChipTransaction } from "@/panels/agent/mentions/live-chips";
import {
  createMentionExtension,
  createSubmitExtension,
  type MentionMenuHooks,
  type MentionMenuState,
} from "@/panels/agent/mentions/mention-extension";
import { MentionMenu } from "@/panels/agent/mentions/MentionMenu";
import { mentionSuggestions } from "@/panels/agent/mentions/mention-sources";

const ACTION_BUTTON =
  "flex size-7 items-center justify-center rounded-full bg-foreground text-background outline-none transition-[background-color,opacity,scale] duration-120 ease-out focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]";

type AgentComposerProps = {
  /** Text to place in the box (e.g. an example prompt); applied whenever `key` changes. */
  seed: { text: string; key: number };
};

type EditorHooks = MentionMenuHooks & { menuOpen: boolean; submit: (steer: boolean) => void };

const IDLE_PLACEHOLDER = "Describe what to design… (@ to mention)";
const BUSY_PLACEHOLDER = "Queue a message… (@ to mention)";

/**
 * What the editor's extensions call into. They are created once with the editor, so the
 * component hands them its latest handlers through this object (updated after each render).
 */
class ComposerLink {
  hooks: EditorHooks = {
    items: () => [],
    onChange: () => {},
    onKeyDown: () => false,
    menuOpen: false,
    submit: () => {},
  };
  placeholder = IDLE_PLACEHOLDER;
  update(hooks: EditorHooks, placeholder: string) {
    this.hooks = hooks;
    this.placeholder = placeholder;
  }
}

/** Suggestions for the @ menu from the live stores (read when the user types). */
const suggestionsFor = (query: string) => {
  const { doc, pageId, selection } = useDocumentStore.getState();
  const { pendingAttachments } = useAgentStore.getState();
  return mentionSuggestions(query, {
    doc,
    pageId,
    selection,
    skills,
    attachments: pendingAttachments,
  });
};

export const AgentComposer = ({ seed }: AgentComposerProps) => {
  const active = useVisibleRun((s) => isRunActive(s.status));
  const runId = useVisibleRun((s) => s.runId);
  const sessionId = useAgentStore((s) => s.visibleSessionId);

  const attachments = useAgentStore((s) => s.pendingAttachments);
  const removeAttachment = useAgentStore((s) => s.removeAttachment);
  const drop = useAttachmentDrop(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  /** The prompt as plain text (chips as "@Label"): drives Send and the skill chip. */
  const [plain, setPlain] = useState("");

  const [link] = useState(() => new ComposerLink());

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder: () => link.placeholder,
      }),
      createMentionExtension(() => link.hooks),
      createSubmitExtension(() => link.hooks),
    ],
    editorProps: {
      attributes: {
        "aria-label": "Prompt",
        "aria-multiline": "true",
        role: "textbox",
        class:
          "tiptap max-h-40 min-h-12 overflow-y-auto px-1 text-xs leading-5 text-foreground outline-none",
      },
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        const images = pastedImageFiles(Array.from(data.files), Array.from(data.types));
        if (images.length === 0) return false; // plain text paste stays the editor's
        event.preventDefault();
        void addAttachmentFiles(images);
        return true;
      },
      // Files dropped on the text are attachments (the container's drop handler adds them).
      handleDrop: (_view, event) => (event.dataTransfer?.files.length ?? 0) > 0,
    },
    onUpdate: ({ editor: current }) => setPlain(current.getText()),
  });

  /**
   * Send the box: a run starts now when the chat is idle, otherwise the message is queued
   * (`steer` sends it into the running agent instead). Mentions are resolved now: the agent
   * gets their context block, the bubble shows the chips.
   */
  const send = (steer = false) => {
    if (!editor) return;
    const prompt = composerToPrompt(editor.getJSON());
    if (!prompt.text.trim()) return;
    // The images travel with the message; the composer starts empty again.
    const images = useAgentStore.getState().pendingAttachments;
    const run = buildRunPrompt(useDocumentStore.getState().doc, prompt, {
      attachments: images.map(({ id, name }) => ({ id, name })),
    });
    if (!run.agentText) return;
    const display = {
      displayText: run.displayText,
      parts: run.parts,
      skillId: run.skillId,
      styleId: run.styleId,
    };
    const restore = editor.getJSON();
    editor.commands.clearContent(true);
    const result =
      steer && active
        ? steerNow(sessionId, run.agentText, images, display)
        : submitPrompt(sessionId, run.agentText, { ...display, attachments: images });
    if (result === "refused") editor.commands.setContent(restore, { emitUpdate: true });
    else if (images.length > 0) useAgentStore.getState().clearAttachments();
  };

  useLayoutEffect(() => {
    link.update(
      {
        items: suggestionsFor,
        onChange: (state) => {
          setMenu(state);
          setMenuIndex(0);
        },
        onKeyDown: (event) => {
          if (!menu) return false;
          const count = menu.items.length;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (count > 0) {
              setMenuIndex((index) =>
                event.key === "ArrowDown" ? (index + 1) % count : (index - 1 + count) % count,
              );
            }
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const item = menu.items[Math.min(menuIndex, count - 1)];
            if (item) menu.choose(item);
            return true;
          }
          if (event.key === "Escape") {
            setMenu(null);
            return true;
          }
          return false;
        },
        menuOpen: menu !== null,
        submit: send,
      },
      active ? BUSY_PLACEHOLDER : IDLE_PLACEHOLDER,
    );
  });

  useEffect(() => {
    if (!editor) return;
    focusRef.current = editor.view.dom;
    // Redraw so the placeholder follows the busy state.
    editor.view.dispatch(editor.state.tr);
  }, [editor, active]);

  const seededKey = useRef(seed.key);
  useEffect(() => {
    if (!editor || seededKey.current === seed.key) return;
    seededKey.current = seed.key;
    editor.commands.setContent(textToComposer(seed.text), { emitUpdate: true });
    editor.commands.focus("end");
  }, [editor, seed]);

  // Like the canvas prompt, the composer ends with a chip for what is selected on the canvas; it
  // follows the selection until text is typed after it.
  useEffect(() => {
    if (!editor) return;
    const sync = (selection: readonly string[]) => {
      if (editor.isDestroyed) return;
      const ref: MentionRef = { kind: "layer", ids: [...selection] };
      const label = mentionTitle(useDocumentStore.getState().doc, ref);
      const tr = liveChipTransaction(
        editor.state,
        "selection",
        selection.length > 0 && label !== null ? [{ ref, label }] : [],
      );
      if (tr) editor.view.dispatch(tr);
    };
    sync(useDocumentStore.getState().selection);
    return useDocumentStore.subscribe((state, prev) => {
      if (state.selection !== prev.selection) sync(state.selection);
    });
  }, [editor]);

  const canSend = plain.trim().length > 0;

  const onPickFiles = (files: FileList | null) => {
    if (files) void addAttachmentFiles(Array.from(files));
    // Reset so picking the same file again still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      {...drop.handlers}
      className={cn(
        "pego-composer relative rounded-lg border border-border bg-muted/40 p-2 transition-[border-color,opacity] duration-(--duration-fast) ease-out focus-within:border-ring",
        drop.dragging && "border-ring",
      )}
    >
      {menu ? (
        <MentionMenu
          items={menu.items}
          active={Math.min(menuIndex, Math.max(0, menu.items.length - 1))}
          onChoose={menu.choose}
          onHover={setMenuIndex}
        />
      ) : null}
      <AttachmentStrip
        attachments={attachments}
        onRemove={(attachment) => {
          removeAttachment(attachment.id);
          editor?.commands.focus();
        }}
        className="mb-1 flex flex-wrap gap-2 px-1 pt-2"
      />
      <EditorContent editor={editor} />
      <div className="mt-1 flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="hidden"
          onChange={(event) => onPickFiles(event.target.files)}
        />
        <button
          type="button"
          aria-label="Attach images"
          title="Attach images"
          onClick={() => fileInputRef.current?.click()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <PaperclipIcon aria-hidden className="size-3.5" />
        </button>
        <AgentSelector restoreFocusRef={focusRef} />
        <SkillChip prompt={plain} restoreFocusRef={focusRef} />
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
          {active ? "Enter to queue · ⌘Enter to send now" : "Enter to send · @ to mention"}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {active ? (
            <button
              type="button"
              aria-label="Cancel run"
              title="Cancel run"
              onClick={() => {
                if (runId) void safely(() => cancelRun(runId));
              }}
              className={cn(ACTION_BUTTON, "hover:bg-foreground/90")}
            >
              <SquareIcon className="size-3 fill-current" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={active ? "Queue message" : "Send"}
            title={active ? "Queue (Enter) · Send to the agent now (⌘Enter)" : "Send (Enter)"}
            disabled={!canSend}
            onClick={() => send()}
            className={cn(ACTION_BUTTON, "hover:bg-foreground/90 disabled:opacity-30")}
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-ring bg-background/85 text-xs font-medium text-foreground transition-opacity duration-(--duration-fast) ease-out",
          drop.dragging ? "opacity-100" : "opacity-0",
        )}
      >
        Drop images to attach
      </div>
    </div>
  );
};
