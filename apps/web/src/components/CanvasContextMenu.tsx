import type { MouseEvent, ReactElement } from "react";
import { findNode } from "@pego/doc";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@pego/ui/components/context-menu";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { HIT_TOLERANCE_PX } from "@/interaction/hit-test";
import { pickAt } from "@/interaction/selection";
import { allComponents, componentOf } from "@/interaction/structure";
import {
  goToComponent,
  runDelete,
  runDuplicate,
  runStructure,
} from "@/interaction/structure-actions";
import { useDocumentStore } from "@/store/use-document-store";
import { useSelectionPrompt } from "@/store/use-selection-prompt-store";
import { useViewportStore } from "@/store/use-viewport-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut label: "⌘⌥G" on macOS, "Ctrl+Alt+G" elsewhere. */
const keys = (...parts: ("mod" | "alt" | "shift" | string)[]) =>
  isMac
    ? parts.map((part) => ({ mod: "⌘", alt: "⌥", shift: "⇧" })[part] ?? part).join("")
    : parts.map((part) => ({ mod: "Ctrl", alt: "Alt", shift: "Shift" })[part] ?? part).join("+");

/**
 * Right-click menu of the canvas. A right-click first selects what is under the pointer (like a
 * click; ⌘/Ctrl goes deep) unless it is already selected; on empty canvas nothing opens.
 */
export const CanvasContextMenu = ({ children }: { children: ReactElement }) => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const state = useDocumentStore.getState();
    const rect = event.currentTarget.getBoundingClientRect();
    const { camera } = useViewportStore.getState();
    const point = screenToDoc(camera, event.clientX - rect.left, event.clientY - rect.top);
    const hit = pickAt(
      state.doc,
      getLayout(state.doc),
      point.x,
      point.y,
      state.selection,
      event.metaKey || event.ctrlKey,
      { tolerance: HIT_TOLERANCE_PX / camera.zoom, pageId: state.pageId },
    );
    if (hit && !state.selection.includes(hit)) state.select([hit]);
    // Nothing to act on: no menu (and no browser menu either).
    if (!hit && state.selection.length === 0) event.preventDefault();
  };

  const single = selection.length === 1 ? findNode(doc, selection[0]!) : null;
  const containers = selection.some((id) => {
    const node = findNode(doc, id);
    return (node?.type === "group" || node?.type === "frame") && !node.reusable;
  });
  const components = allComponents(doc, selection);
  const instance = single?.type === "ref" ? single : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuItem
          shortcut={keys("mod", "K")}
          onSelect={() => useSelectionPrompt.getState().setOpen(true)}
        >
          Ask Pego about this
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem shortcut={keys("mod", "C")} onSelect={() => document.execCommand("copy")}>
          Copy layer IDs
        </ContextMenuItem>
        <ContextMenuItem shortcut={keys("mod", "D")} onSelect={() => runDuplicate()}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem shortcut="]" onSelect={() => runStructure("front")}>
          Bring to front
        </ContextMenuItem>
        <ContextMenuItem shortcut="[" onSelect={() => runStructure("back")}>
          Send to back
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem shortcut={keys("mod", "G")} onSelect={() => runStructure("group")}>
          Group selection
        </ContextMenuItem>
        <ContextMenuItem shortcut={keys("mod", "alt", "G")} onSelect={() => runStructure("frame")}>
          Frame selection
        </ContextMenuItem>
        {containers ? (
          <ContextMenuItem
            shortcut={keys("mod", "shift", "G")}
            onSelect={() => runStructure("ungroup")}
          >
            Ungroup
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          shortcut={keys("mod", "alt", "K")}
          onSelect={() => runStructure("component")}
        >
          {components ? "Detach component" : "Create component"}
        </ContextMenuItem>
        {instance ? (
          <>
            <ContextMenuItem
              shortcut={keys("mod", "alt", "X")}
              onSelect={() => runStructure("detach-instance")}
            >
              Detach instance
            </ContextMenuItem>
            {componentOf(doc, instance.id) ? (
              <ContextMenuItem onSelect={() => goToComponent(instance.id)}>
                Go to component
              </ContextMenuItem>
            ) : null}
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem shortcut="⌫" destructive onSelect={() => runDelete()}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
