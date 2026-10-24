import { useState, type MouseEvent, type ReactElement } from "react";
import { findNode } from "@pego/doc";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@pego/ui/components/context-menu";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { copySelectionForAgent } from "@/interaction/agent-reference";
import { runCopyAs } from "@/interaction/copy-as";
import { runPasteHere, runPasteReplace } from "@/interaction/clipboard-actions";
import { flipSelection } from "@/interaction/flip";
import { contextMenuTarget } from "@/interaction/pick-on-canvas";
import { allClipped, allComponents, allVisible, componentOf } from "@/interaction/structure";
import {
  goToComponent,
  runDelete,
  runDuplicate,
  runStructure,
} from "@/interaction/structure-actions";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useSelectionPrompt } from "@/store/use-selection-prompt-store";
import { useSettingsModal, useSettingsStore } from "@/store/use-settings-store";
import { useViewportStore } from "@/store/use-viewport-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut label: "⌘⌥G" on macOS, "Ctrl+Alt+G" elsewhere. */
const keys = (...parts: ("mod" | "alt" | "shift" | string)[]) =>
  isMac
    ? parts.map((part) => ({ mod: "⌘", alt: "⌥", shift: "⇧" })[part] ?? part).join("")
    : parts.map((part) => ({ mod: "Ctrl", alt: "Alt", shift: "Shift" })[part] ?? part).join("+");

type DocPoint = { x: number; y: number };

/** Canvas preferences and the settings modal, at the end of both canvas menus (like pen.dev). */
const CanvasSettingsItems = () => {
  const snapToPixel = useSettingsStore((s) => s.snapToPixel);
  const connectors = useSettingsStore((s) => s.connectors);
  return (
    <>
      <ContextMenuCheckboxItem
        checked={connectors}
        onCheckedChange={(checked) =>
          useSettingsStore.getState().update({ connectors: checked === true })
        }
      >
        Show wireflow connectors
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem
        checked={snapToPixel}
        onCheckedChange={(checked) =>
          useSettingsStore.getState().update({ snapToPixel: checked === true })
        }
      >
        Snap to whole pixels
      </ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        shortcut={keys("mod", ",")}
        onSelect={() => useSettingsModal.getState().openSettings("general")}
      >
        Open settings…
      </ContextMenuItem>
    </>
  );
};

/** The selection's actions, shared by the canvas and the layers panel right-click menus. */
export const SelectionMenuContent = ({ point }: { point?: DocPoint | null }) => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const single = selection.length === 1 ? findNode(doc, selection[0]!) : null;
  const nodes = selection.flatMap((id) => findNode(doc, id) ?? []);
  const containers = nodes.some(
    (node) => (node.type === "group" || node.type === "frame") && !node.reusable,
  );
  const flexFrame = nodes.some((node) => node.type === "frame" && node.layout !== "none");
  const alreadyFlex = single?.type === "frame" && single.layout !== "none";
  const hasFrame = nodes.some((node) => node.type === "frame");
  const components = allComponents(doc, selection);
  const instance = single?.type === "ref" ? single : null;
  const none = selection.length === 0;
  const oneLayer = selection.length === 1;

  return (
    <ContextMenuContent className="min-w-56">
      <ContextMenuItem
        shortcut={keys("mod", "K")}
        disabled={none}
        onSelect={() => useSelectionPrompt.getState().setOpen(true)}
      >
        Ask Pego about this
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut={keys("mod", "X")} onSelect={() => document.execCommand("cut")}>
        Cut
      </ContextMenuItem>
      <ContextMenuItem shortcut={keys("mod", "C")} onSelect={() => document.execCommand("copy")}>
        Copy
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={none}>Copy as</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={!oneLayer} onSelect={() => void runCopyAs("svg")}>
            SVG
          </ContextMenuItem>
          <ContextMenuItem disabled={!oneLayer} onSelect={() => void runCopyAs("png")}>
            PNG
          </ContextMenuItem>
          <ContextMenuItem disabled={!oneLayer} onSelect={() => void runCopyAs("react-tailwind")}>
            React + Tailwind
          </ContextMenuItem>
          <ContextMenuItem disabled={!oneLayer} onSelect={() => void runCopyAs("html-css")}>
            HTML/CSS
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void runCopyAs("json")}>JSON</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            shortcut={keys("mod", "shift", "C")}
            onSelect={() => void copySelectionForAgent()}
          >
            For AI (project and node ids)
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => void runPasteHere(point ?? undefined)}>
        Paste here
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("mod", "shift", "R")}
        disabled={none}
        onSelect={() => void runPasteReplace()}
      >
        Paste to replace
      </ContextMenuItem>
      <ContextMenuItem shortcut={keys("mod", "D")} disabled={none} onSelect={() => runDuplicate()}>
        Duplicate
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut="]" disabled={none} onSelect={() => runStructure("front")}>
        Bring to front
      </ContextMenuItem>
      <ContextMenuItem shortcut="[" disabled={none} onSelect={() => runStructure("back")}>
        Send to back
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        shortcut={keys("mod", "G")}
        disabled={none}
        onSelect={() => runStructure("group")}
      >
        Group selection
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("mod", "alt", "G")}
        disabled={none}
        onSelect={() => runStructure("frame")}
      >
        Frame selection
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("mod", "shift", "G")}
        disabled={!containers}
        onSelect={() => runStructure("ungroup")}
      >
        Ungroup
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("shift", "A")}
        disabled={none || alreadyFlex}
        onSelect={() => runStructure("add-flex")}
      >
        Add flex layout
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("shift", "alt", "A")}
        disabled={!flexFrame}
        onSelect={() => runStructure("remove-flex")}
      >
        Remove flex layout
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        shortcut={keys("mod", "alt", "K")}
        disabled={none}
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
      <ContextMenuItem
        shortcut={keys("shift", "H")}
        disabled={none}
        onSelect={() => flipSelection("x")}
      >
        Flip horizontal
      </ContextMenuItem>
      <ContextMenuItem
        shortcut={keys("shift", "V")}
        disabled={none}
        onSelect={() => flipSelection("y")}
      >
        Flip vertical
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut="⌫" destructive disabled={none} onSelect={() => runDelete()}>
        Delete
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>Settings</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            shortcut={keys("mod", "shift", "H")}
            disabled={none}
            onSelect={() => runStructure("toggle-visible")}
          >
            {allVisible(doc, selection) ? "Hide layer" : "Show layer"}
          </ContextMenuItem>
          <ContextMenuCheckboxItem
            checked={allClipped(doc, selection)}
            disabled={!hasFrame}
            onCheckedChange={() => runStructure("toggle-clip")}
          >
            Clip content
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <CanvasSettingsItems />
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  );
};

/** Right-click menu on empty canvas: paste at the pointer, select everything, canvas settings. */
const EmptyMenuContent = ({ point }: { point: DocPoint | null }) => (
  <ContextMenuContent className="min-w-48">
    <ContextMenuItem onSelect={() => void runPasteHere(point ?? undefined)}>
      Paste here
    </ContextMenuItem>
    <ContextMenuItem
      shortcut={keys("mod", "A")}
      onSelect={() => {
        const state = useDocumentStore.getState();
        state.select(activePage(state).children.map((node) => node.id));
      }}
    >
      Select all
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuSub>
      <ContextMenuSubTrigger>Settings</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <CanvasSettingsItems />
      </ContextMenuSubContent>
    </ContextMenuSub>
  </ContextMenuContent>
);

/**
 * Right-click menu of the canvas. A right-click acts on the selection when it lands on a selected
 * layer, inside one, or inside the selection's bounds; elsewhere it first selects what is under
 * the pointer (like a click: a frame's caption picks the frame, ⌘/Ctrl goes deep). On empty canvas
 * it clears the selection and opens a short menu. Paste here lands at the pointer.
 */
export const CanvasContextMenu = ({ children }: { children: ReactElement }) => {
  const [point, setPoint] = useState<DocPoint | null>(null);
  const [empty, setEmpty] = useState(false);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const state = useDocumentStore.getState();
    const rect = event.currentTarget.getBoundingClientRect();
    const { camera } = useViewportStore.getState();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const target = contextMenuTarget(
      state,
      getLayout(state.doc),
      camera,
      screen,
      event.metaKey || event.ctrlKey,
    );
    setPoint(screenToDoc(camera, screen.x, screen.y));
    setEmpty(target.empty);
    if (target.selection !== state.selection) state.select([...target.selection]);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      {empty ? <EmptyMenuContent point={point} /> : <SelectionMenuContent point={point} />}
    </ContextMenu>
  );
};
