import { Redo2Icon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { LayersPanel } from "@/panels/LayersPanel";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { useDocumentStore } from "@/store/use-document-store";
import { Button } from "@pego/ui/components/button";
import { FileMenu } from "@/persistence/FileMenu";

const HistoryButtons = () => {
  const canUndo = useDocumentStore((s) => s.history.past.length > 0);
  const canRedo = useDocumentStore((s) => s.history.future.length > 0);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2Icon />
      </Button>
    </div>
  );
};

export const EditorShell = () => (
  <div className="flex h-full flex-col bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">Pego</span>
        <FileMenu />
      </div>
      <div className="flex items-center gap-2">
        <HistoryButtons />
        <Button size="sm" variant="secondary">
          Share
        </Button>
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <LayersPanel />
      </aside>
      <main className="min-w-0 flex-1">
        <Canvas />
      </main>
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
        <PropertiesPanel />
      </aside>
    </div>
  </div>
);
