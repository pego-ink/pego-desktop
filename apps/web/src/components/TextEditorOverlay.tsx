import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";
import { findNode, resolveString } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { useDocumentStore } from "@/store/use-document-store";
import { useTextEditStore, type TextEditTarget } from "@/store/use-text-edit-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { buildConfirmOps, createTextColor, DEFAULT_FONT_SIZE } from "@/text-edit/confirm-edit";
import {
  buildPlacement,
  deriveEditorStyle,
  type EditorTextProps,
  type PlacementStep,
} from "@/text-edit/editor-style";
import { ensureInterFont } from "@/text-edit/ensure-font";

const ACCENT = "#B79CFF";
const CREATE_PROPS: EditorTextProps = { fontFamily: "Inter", fontSize: DEFAULT_FONT_SIZE };

/** Snapshot taken when the editor opens: what is edited and where it sits in document space. */
const openSession = (target: TextEditTarget) => {
  const { doc } = useDocumentStore.getState();
  const layout = getLayout(doc);
  if (target.mode === "edit") {
    const node = findNode(doc, target.id);
    const box = layout.get(target.id);
    const placement = buildPlacement(doc, target.id, layout);
    if (!node || node.type !== "text" || !box || !placement) return null;
    return {
      props: node as EditorTextProps,
      placement,
      width: box.width,
      initial: resolveString(node.content, doc.variables),
      fallbackColor: "#000000",
    };
  }
  const parentBox = target.parentId ? layout.get(target.parentId) : undefined;
  return {
    props: CREATE_PROPS,
    placement: [
      { x: (parentBox?.x ?? 0) + target.x, y: (parentBox?.y ?? 0) + target.y, rotation: 0 },
    ] satisfies PlacementStep[],
    width: 0,
    initial: "",
    fallbackColor: createTextColor(doc, target.parentId),
  };
};

const Editor = ({ target }: { target: TextEditTarget }) => {
  const session = useMemo(() => openSession(target), [target]);
  const camera = useViewportStore((s) => s.camera);
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  const finish = useCallback(
    (commitChanges: boolean) => {
      if (done.current) return;
      done.current = true;
      const { doc, commit, select } = useDocumentStore.getState();
      const content = ref.current?.textContent ?? "";
      const result = commitChanges ? buildConfirmOps(doc, target, content) : null;
      if (result && commit(result.ops, { label: result.label }) && result.selectId) {
        select([result.selectId]);
      }
      useTextEditStore.getState().stop();
    },
    [target],
  );

  useEffect(() => {
    void ensureInterFont();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !session) return;
    el.textContent = session.initial;
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (target.mode === "create") range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [session, target.mode]);

  // Clicking outside confirms; capture phase so it runs before canvas handlers react.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      finish(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [finish]);

  // The edited node vanished (undo, delete): close without committing.
  useEffect(() => {
    if (target.mode !== "edit") return;
    return useDocumentStore.subscribe((state) => {
      if (!findNode(state.doc, target.id)) finish(false);
    });
  }, [target, finish]);

  useEffect(() => {
    if (!session) useTextEditStore.getState().stop();
  }, [session]);

  if (!session) return null;
  const { props, placement, width, fallbackColor } = session;
  const style = deriveEditorStyle(
    props,
    placement,
    width,
    camera,
    useDocumentStore.getState().doc.variables,
    fallbackColor,
  );

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      finish(true);
    }
  };

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="Edit text"
      aria-multiline="true"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: style.width,
        minWidth: 1,
        minHeight: "1lh",
        transform: style.transform,
        transformOrigin: "0 0",
        margin: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        outline: `${style.outlineWidth}px solid ${ACCENT}`,
        outlineOffset: 0,
        fontFamily: `${style.fontFamily}, Inter, sans-serif`,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeight: "normal",
        color: style.color,
        caretColor: style.color,
        textAlign: style.textAlign,
        whiteSpace: style.wraps ? "pre-wrap" : "pre",
        overflowWrap: style.wraps ? "break-word" : "normal",
        fontKerning: "normal",
        WebkitFontSmoothing: "antialiased",
      }}
    />
  );
};

/** On-canvas text editor, positioned over the edited node. Rendered inside the canvas container. */
export const TextEditorOverlay = () => {
  const target = useTextEditStore((s) => s.target);
  return target ? <Editor key={targetKey(target)} target={target} /> : null;
};

const targetKey = (t: TextEditTarget) =>
  t.mode === "edit" ? `edit:${t.id}` : `create:${t.parentId}:${t.x}:${t.y}`;
