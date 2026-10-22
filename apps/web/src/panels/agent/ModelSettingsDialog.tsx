import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCwIcon } from "lucide-react";
import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import { CopyField } from "@pego/ui/components/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { cn } from "@pego/ui/lib/utils";
import { saveApiKey } from "@/agent/api-key";
import { findAgentInfo, LOCAL_AGENT_NAMES, refreshAgents } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { ApiKeyDialog } from "@/panels/agent/ApiKeyDialog";
import { BridgeSetup } from "@/panels/agent/BridgeSetup";
import { ModelPicker } from "@/panels/agent/ModelPicker";
import { ProviderLogo } from "@/panels/agent/ProviderLogo";
import { StatusDot } from "@/panels/agent/StatusDot";
import { safely } from "@/panels/agent/run-actions";
import {
  agentStatus,
  AGENT_PROVIDER,
  API_BACKEND_LABEL,
  INSTALL_HINTS,
  isRunActive,
  noteCommand,
} from "@/panels/agent/agent-format";

export type SettingsSection = "top" | "add-provider" | "bridge";

/** Splits `code` spans out of an agent note so commands read as commands. */
const NoteText = ({ note }: { note: string }) => (
  <>
    {note.split(/(`[^`]+`)/).map((part, index) =>
      part.startsWith("`") && part.endsWith("`") ? (
        <code key={index} className="rounded-sm bg-muted px-1 font-mono text-foreground">
          {part.slice(1, -1)}
        </code>
      ) : (
        <span key={index}>{part}</span>
      ),
    )}
  </>
);

const UseButton = ({
  active,
  disabled,
  onUse,
}: {
  active: boolean;
  disabled: boolean;
  onUse: () => void;
}) =>
  active ? (
    <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-foreground">Active</span>
  ) : (
    <Button size="xs" variant="secondary" disabled={disabled} onClick={onUse}>
      Use
    </Button>
  );

const Card = ({
  provider,
  title,
  titleId,
  badge,
  action,
  children,
}: {
  provider: Parameters<typeof ProviderLogo>[0]["provider"];
  title: string;
  titleId: string;
  badge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) => (
  <section aria-labelledby={titleId} className="grid gap-2 rounded-lg border border-border p-3">
    <div className="flex items-center gap-2">
      <ProviderLogo provider={provider} />
      <h3 id={titleId} className="min-w-0 truncate text-xs font-medium">
        {title}
      </h3>
      {badge}
      <span className="ml-auto flex shrink-0 items-center gap-2">{action}</span>
    </div>
    {children}
  </section>
);

const ApiKeyCard = ({
  hasKey,
  onHasKeyChange,
}: {
  hasKey: boolean;
  onHasKeyChange: (hasKey: boolean) => void;
}) => {
  const active = useAgentStore((s) => s.backend === "api");
  const locked = useAgentStore((s) => isRunActive(s.status));
  const setBackend = useAgentStore((s) => s.setBackend);
  const [keyOpen, setKeyOpen] = useState(false);

  const remove = async () => {
    if (await safely(() => saveApiKey(null))) onHasKeyChange(false);
  };

  return (
    <Card
      provider="anthropic"
      title={API_BACKEND_LABEL}
      titleId="ms-api"
      action={<UseButton active={active} disabled={locked} onUse={() => setBackend("api")} />}
    >
      <p className="text-[11px] leading-4 text-muted-foreground">
        Runs in this browser and calls api.anthropic.com with your own key.
      </p>
      <div className="flex items-center gap-2 text-xs">
        <StatusDot tone={hasKey ? "ready" : "warn"} />
        <span className="min-w-0 flex-1 truncate">
          {hasKey ? "Key saved locally" : "No API key set"}
        </span>
        {hasKey ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void remove()}
          >
            Remove
          </Button>
        ) : null}
        <Button size="xs" variant="secondary" onClick={() => setKeyOpen(true)}>
          {hasKey ? "Replace key" : "Add key"}
        </Button>
      </div>
      <ApiKeyDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        hasKey={hasKey}
        onChanged={onHasKeyChange}
      />
    </Card>
  );
};

const LocalAgentCard = ({ id }: { id: LocalAgentId }) => {
  const info = useAgentStore((s) => findAgentInfo(s.bridge.agents, id));
  const connected = useAgentStore((s) => s.bridge.connected);
  const active = useAgentStore((s) => s.backend === "local" && s.localAgentId === id);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
  const setBackend = useAgentStore((s) => s.setBackend);

  const status = agentStatus(info, connected);
  const installed = connected && info?.installed === true;
  const command = noteCommand(info?.note);

  return (
    <Card
      provider={AGENT_PROVIDER[id]}
      title={info?.name ?? LOCAL_AGENT_NAMES[id]}
      titleId={`ms-${id}`}
      badge={
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot tone={status.tone} />
          {status.label}
        </span>
      }
      action={
        installed ? (
          <UseButton
            active={active}
            disabled={locked}
            onUse={() => {
              setLocalAgent(id);
              setBackend("local");
            }}
          />
        ) : null
      }
    >
      {info?.path ? (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={info.path}>
          {info.path}
        </p>
      ) : null}
      {info?.note ? (
        <div className="grid gap-1.5">
          <p
            className={cn(
              "text-[11px] leading-4",
              installed ? "text-amber-400" : "text-muted-foreground",
            )}
          >
            <NoteText note={info.note} />
          </p>
          {command && installed ? <CopyField value={command} /> : null}
        </div>
      ) : null}
      {installed && info.supportsModels ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-muted-foreground">Default model</span>
          <ModelPicker agentId={id} disabled={locked} />
        </div>
      ) : installed ? (
        <p className="text-[11px] text-muted-foreground">The CLI picks its own model.</p>
      ) : null}
      {!installed && connected ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Not installed. See Add provider below.
        </p>
      ) : null}
    </Card>
  );
};

const AddProvider = () => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const missing = LOCAL_AGENT_IDS.filter(
    (id) => !connected || findAgentInfo(agents, id)?.installed !== true,
  );

  return (
    <div className="grid gap-2">
      <p className="text-[11px] leading-4 text-muted-foreground">
        Pego can&apos;t install CLIs itself. Run a command in your terminal, then choose Refresh
        detection.
      </p>
      {missing.length === 0 ? (
        <p className="text-xs">Every supported agent is installed.</p>
      ) : (
        missing.map((id) => (
          <div
            key={id}
            role="group"
            aria-label={`Install ${LOCAL_AGENT_NAMES[id]}`}
            className="grid gap-1.5 rounded-lg border border-border p-3"
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              <ProviderLogo provider={AGENT_PROVIDER[id]} />
              {LOCAL_AGENT_NAMES[id]}
            </div>
            <CopyField value={INSTALL_HINTS[id]} />
          </div>
        ))
      )}
    </div>
  );
};

type ModelSettingsDialogProps = {
  /** Which part to scroll to; null keeps the dialog closed. */
  section: SettingsSection | null;
  onClose: () => void;
  hasKey: boolean;
  onHasKeyChange: (hasKey: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
    {children}
  </h3>
);

/** Providers and agents in one place: API key, each local agent, and how to add more. */
export const ModelSettingsDialog = ({
  section,
  onClose,
  hasKey,
  onHasKeyChange,
  onCloseAutoFocus,
}: ModelSettingsDialogProps) => {
  const connected = useAgentStore((s) => s.bridge.connected);
  const refreshing = useAgentStore((s) => s.agentsRefreshing);
  const addRef = useRef<HTMLElement>(null);
  const bridgeRef = useRef<HTMLElement>(null);
  const open = section !== null;

  useEffect(() => {
    if (section !== "add-provider" && section !== "bridge") return;
    const frame = requestAnimationFrame(() => {
      (section === "bridge" ? bridgeRef : addRef).current?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-xl"
        aria-describedby="ms-description"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Model settings</DialogTitle>
          <DialogDescription id="ms-description">
            Choose who runs the agent. Local CLIs use your own login on this machine.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 grid max-h-[65vh] gap-4 overflow-y-auto px-1 py-1 [overscroll-behavior:contain]">
          <section ref={bridgeRef} aria-label="Bridge" className="grid gap-2">
            <div className="flex items-center gap-2 text-xs">
              <StatusDot tone={connected ? "ready" : "off"} />
              <span className="flex-1">
                {connected ? "Bridge connected" : "Bridge not running"}
              </span>
              <Button
                size="xs"
                variant="secondary"
                disabled={!connected || refreshing}
                onClick={() => refreshAgents()}
              >
                <RefreshCwIcon aria-hidden className={cn(refreshing && "animate-spin")} />
                Refresh detection
              </Button>
            </div>
            {connected ? null : <BridgeSetup showStatus={false} />}
          </section>
          <div className="grid gap-2">
            <SectionHeading>Providers</SectionHeading>
            <ApiKeyCard hasKey={hasKey} onHasKeyChange={onHasKeyChange} />
            {LOCAL_AGENT_IDS.map((id) => (
              <LocalAgentCard key={id} id={id} />
            ))}
          </div>
          <section ref={addRef} aria-label="Add provider" className="grid gap-2">
            <SectionHeading>Add provider</SectionHeading>
            <AddProvider />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
