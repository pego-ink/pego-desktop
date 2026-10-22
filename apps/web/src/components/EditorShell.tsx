import { useState } from "react";
import { Redo2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { LayersPanel } from "@/panels/LayersPanel";
import { PagesPanel } from "@/pages/PagesPanel";
import { AgentPanel } from "@/panels/agent/AgentPanel";
import { isRunActive } from "@/panels/agent/agent-format";
import { useAgentStore } from "@/agent/use-agent-store";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { useDocumentStore } from "@/store/use-document-store";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
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

type LeftTab = "layers" | "agent";

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={cn(
      "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
      active && "bg-secondary text-foreground shadow-xs",
    )}
  >
    {children}
  </button>
);

/** Left column: layer tree, or the agent panel (wider, like the design's agent view). */
const LeftColumn = () => {
  const [tab, setTab] = useState<LeftTab>("layers");
  const working = useAgentStore((s) => isRunActive(s.status));
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-card",
        tab === "agent" ? "w-80" : "w-64",
      )}
    >
      <div
        role="tablist"
        aria-label="Left panel"
        className="flex shrink-0 gap-0.5 border-b border-border p-1.5"
      >
        <TabButton active={tab === "layers"} onClick={() => setTab("layers")}>
          Layers
        </TabButton>
        <TabButton active={tab === "agent"} onClick={() => setTab("agent")}>
          <SparklesIcon />
          Agent
          {working && tab !== "agent" ? (
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[#B79CFF]" />
          ) : null}
        </TabButton>
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "layers" ? "flex" : "hidden")}>
        <PagesPanel />
        <LayersPanel />
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "agent" ? "flex" : "hidden")}>
        <AgentPanel />
      </div>
    </aside>
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
      <LeftColumn />
      <main className="min-w-0 flex-1">
        <Canvas />
      </main>
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
        <PropertiesPanel />
      </aside>
    </div>
  </div>
);
