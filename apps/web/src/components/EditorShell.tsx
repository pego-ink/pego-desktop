import { Canvas } from "@/components/Canvas";
import { Button } from "@pego/ui/components/button";

const PanelHeader = ({ title }: { title: string }) => (
  <div className="flex h-10 shrink-0 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
    {title}
  </div>
);

export const EditorShell = () => (
  <div className="flex h-full flex-col bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      <span className="text-sm font-semibold">Pego</span>
      <Button size="sm" variant="secondary">
        Share
      </Button>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <PanelHeader title="Layers" />
        <div className="p-3 text-xs text-muted-foreground">Layers placeholder</div>
      </aside>
      <main className="min-w-0 flex-1">
        <Canvas />
      </main>
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
        <PanelHeader title="Properties" />
        <div className="p-3 text-xs text-muted-foreground">Properties placeholder</div>
      </aside>
    </div>
  </div>
);
