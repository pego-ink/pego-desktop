import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { findNode, isContainer } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { ContextMenu, ContextMenuTrigger } from "@pego/ui/components/context-menu";
import { SelectionMenuContent } from "@/components/CanvasContextMenu";
import { LayerRow, type SelectMode } from "@/panels/LayerRow";
import { buildMoveOp, dropZoneAt, type DropZone } from "@/panels/drop-position";
import { ancestorIds, flattenLayers, layerLabel, rangeIds } from "@/panels/layer-rows";

/** How long a drag rests on a collapsed folder before it opens. */
const OPEN_ON_DRAG_MS = 800;

type DropTarget = { id: string; zone: DropZone };

export const LayersPanel = () => {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const hoveredId = useDocumentStore((s) => s.hoveredId);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reveal selected layers (e.g. picked on the canvas) by expanding their ancestors.
  const [seenSelection, setSeenSelection] = useState(selection);
  if (seenSelection !== selection) {
    setSeenSelection(selection);
    const hidden = selection
      .flatMap((id) => ancestorIds(doc, id))
      .filter((id) => collapsed.has(id));
    if (hidden.length > 0)
      setCollapsed(new Set([...collapsed].filter((id) => !hidden.includes(id))));
  }

  useEffect(() => {
    const id = selection.at(-1);
    if (!id) return;
    listRef.current
      ?.querySelector(`[data-layer-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selection, collapsed]);

  const pageId = useDocumentStore((s) => s.pageId);
  const rows = useMemo(() => flattenLayers(doc, collapsed, pageId), [doc, collapsed, pageId]);
  const selected = useMemo(() => new Set(selection), [selection]);

  const onToggle = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  // The row a Shift-click range starts from: the last row clicked without Shift.
  const anchor = useRef<string | null>(null);
  const onSelect = useCallback(
    (id: string, mode: SelectMode) => {
      const { selection: current, select } = useDocumentStore.getState();
      if (mode === "range")
        return select(rangeIds(rows, anchor.current ?? current.at(-1) ?? null, id));
      anchor.current = id;
      if (mode === "replace") return select([id]);
      select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    },
    [rows],
  );

  const onToggleVisible = useCallback((id: string) => {
    const { doc: current, commit } = useDocumentStore.getState();
    const node = findNode(current, id);
    if (!node) return;
    const hide = node.visible !== false;
    commit([{ op: "update", id, props: { visible: hide ? false : null } }], {
      label: hide ? "Hide layer" : "Show layer",
    });
  }, []);

  const onHover = useCallback(
    (id: string | null) => useDocumentStore.getState().setHovered(id),
    [],
  );

  const onEndRename = useCallback((id: string, name: string | null) => {
    setRenamingId(null);
    const trimmed = name?.trim();
    if (!trimmed) return;
    const { doc: current, commit } = useDocumentStore.getState();
    const node = findNode(current, id);
    if (!node || trimmed === layerLabel(current, node)) return;
    commit([{ op: "update", id, props: { name: trimmed } }], { label: "Rename layer" });
  }, []);

  const openTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearDrag = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
    if (openTimer.current) clearTimeout(openTimer.current.timer);
    openTimer.current = null;
  }, []);

  const onDragStartRow = useCallback((id: string, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDragId(id);
  }, []);

  const onDragOverRow = useCallback(
    (id: string, ratio: number, event: DragEvent<HTMLElement>) => {
      if (!dragId) return;
      const { doc: current } = useDocumentStore.getState();
      const target = findNode(current, id);
      if (!target) return;
      const zone = dropZoneAt(ratio, isContainer(target));
      // Resting on a collapsed folder opens it, so the drop can go deeper.
      if (zone === "inside" && collapsed.has(id)) {
        if (openTimer.current?.id !== id) {
          if (openTimer.current) clearTimeout(openTimer.current.timer);
          const timer = setTimeout(() => {
            openTimer.current = null;
            setCollapsed((prev) => new Set([...prev].filter((x) => x !== id)));
          }, OPEN_ON_DRAG_MS);
          openTimer.current = { id, timer };
        }
      } else if (openTimer.current) {
        clearTimeout(openTimer.current.timer);
        openTimer.current = null;
      }
      if (!buildMoveOp(current, dragId, id, zone)) {
        setDropTarget((prev) => (prev ? null : prev));
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget((prev) => (prev?.id === id && prev.zone === zone ? prev : { id, zone }));
    },
    [dragId, collapsed],
  );

  const onDropRow = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (dragId && dropTarget) {
        const { doc: current, commit } = useDocumentStore.getState();
        const op = buildMoveOp(current, dragId, dropTarget.id, dropTarget.zone);
        if (op) commit([op], { label: "Reorder layer" });
      }
      clearDrag();
    },
    [dragId, dropTarget, clearDrag],
  );

  return (
    <>
      <div className="flex h-9 shrink-0 items-center px-4 pt-1">
        <span className="font-mono text-[10px] tracking-wider text-subtle-foreground uppercase">
          Layers
        </span>
      </div>
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenu={(event) => {
            // Right-click on a row acts on it (selecting it first unless it is part of the selection).
            const row = (event.target as HTMLElement).closest<HTMLElement>("[data-layer-id]");
            const id = row?.dataset.layerId;
            const state = useDocumentStore.getState();
            if (id && !state.selection.includes(id)) state.select([id]);
            if (!id && state.selection.length === 0) event.preventDefault();
          }}
        >
          <div
            ref={listRef}
            role="tree"
            aria-label="Layers"
            aria-multiselectable
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            onClick={(event) => {
              if (event.target === event.currentTarget) useDocumentStore.getState().select([]);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDropTarget(null);
            }}
          >
            {rows.length === 0 ? (
              <p className="px-2 py-2 text-[13px] text-muted-foreground">No layers yet.</p>
            ) : null}
            {rows.map((row) => (
              <LayerRow
                key={row.node.id}
                node={row.node}
                label={layerLabel(doc, row.node)}
                depth={row.depth}
                hasChildren={row.hasChildren}
                expanded={row.expanded}
                hidden={row.hidden}
                selected={selected.has(row.node.id)}
                hovered={hoveredId === row.node.id}
                renaming={renamingId === row.node.id}
                drop={dropTarget?.id === row.node.id ? dropTarget.zone : null}
                dragging={dragId === row.node.id}
                onToggle={onToggle}
                onSelect={onSelect}
                onToggleVisible={onToggleVisible}
                onHover={onHover}
                onStartRename={setRenamingId}
                onEndRename={onEndRename}
                onDragStartRow={onDragStartRow}
                onDragOverRow={onDragOverRow}
                onDropRow={onDropRow}
                onDragEndRow={clearDrag}
              />
            ))}
          </div>
        </ContextMenuTrigger>
        <SelectionMenuContent />
      </ContextMenu>
    </>
  );
};
