import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { findNode, isContainer } from "@pego/doc";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { useDocumentStore } from "@/store/use-document-store";
import { LayerRow } from "@/panels/LayerRow";
import { buildMoveOp, dropZoneAt, type DropZone } from "@/panels/drop-position";
import { ancestorIds, flattenLayers } from "@/panels/layer-rows";

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

  const rows = useMemo(() => flattenLayers(doc, collapsed), [doc, collapsed]);
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

  const onSelect = useCallback((id: string, additive: boolean) => {
    const { selection: current, select } = useDocumentStore.getState();
    if (!additive) return select([id]);
    select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
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
    if (!node || trimmed === (node.name ?? node.type)) return;
    commit([{ op: "update", id, props: { name: trimmed } }], { label: "Rename layer" });
  }, []);

  const clearDrag = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
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
      if (!buildMoveOp(current, dragId, id, zone)) {
        setDropTarget((prev) => (prev ? null : prev));
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget((prev) => (prev?.id === id && prev.zone === zone ? prev : { id, zone }));
    },
    [dragId],
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
      <PanelHeader>Layers</PanelHeader>
      <div
        ref={listRef}
        role="tree"
        aria-label="Layers"
        aria-multiselectable
        className="min-h-0 flex-1 overflow-y-auto py-1.5"
        onClick={(event) => {
          if (event.target === event.currentTarget) useDocumentStore.getState().select([]);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
      >
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No layers yet.</p>
        ) : null}
        {rows.map((row) => (
          <LayerRow
            key={row.node.id}
            node={row.node}
            depth={row.depth}
            hasChildren={row.hasChildren}
            expanded={row.expanded}
            selected={selected.has(row.node.id)}
            hovered={hoveredId === row.node.id}
            renaming={renamingId === row.node.id}
            drop={dropTarget?.id === row.node.id ? dropTarget.zone : null}
            dragging={dragId === row.node.id}
            onToggle={onToggle}
            onSelect={onSelect}
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
    </>
  );
};
