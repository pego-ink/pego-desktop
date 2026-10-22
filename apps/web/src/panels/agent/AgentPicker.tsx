import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react";
import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { loadApiKey } from "@/agent/api-key";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { ApiKeyDialog } from "@/panels/agent/ApiKeyDialog";
import { BridgeSetup } from "@/panels/agent/BridgeSetup";
import { ModelPicker } from "@/panels/agent/ModelPicker";
import { StatusDot } from "@/panels/agent/StatusDot";
import {
  agentDetail,
  agentStatus,
  API_BACKEND_LABEL,
  isRunActive,
} from "@/panels/agent/agent-format";

const rowClass =
  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";

const LocalAgentOptions = ({ onPick }: { onPick: (id: LocalAgentId) => void }) => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const backend = useAgentStore((s) => s.backend);
  const activeId = useAgentStore((s) => s.localAgentId);

  return LOCAL_AGENT_IDS.map((id) => {
    const info = findAgentInfo(agents, id);
    const status = agentStatus(info, connected);
    const detail = agentDetail(id, info, connected);
    const active = backend === "local" && id === activeId;
    return (
      <button
        key={id}
        type="button"
        role="option"
        aria-selected={active}
        disabled={!status.selectable}
        onClick={() => onPick(id)}
        className={rowClass}
      >
        <StatusDot tone={status.tone} className="mt-1.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate">{info?.name ?? LOCAL_AGENT_NAMES[id]}</span>
            <span className="text-[11px] text-muted-foreground">{status.label}</span>
          </span>
          {detail ? (
            <span className="block text-[11px] leading-4 break-words text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </span>
        {active ? <CheckIcon className="mt-0.5 size-3.5 shrink-0" /> : null}
      </button>
    );
  });
};

const LocalAgentDetails = ({ agentId, locked }: { agentId: LocalAgentId; locked: boolean }) => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const info = findAgentInfo(agents, agentId);
  const detail = agentDetail(agentId, info, true);
  const usable = info?.installed === true;

  return (
    <div className="grid gap-2">
      {info && usable && info.supportsModels ? (
        <ModelPicker agentId={agentId} disabled={locked} />
      ) : null}
      {detail ? (
        <p
          className={cn(
            "text-[11px] leading-4",
            usable ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {info?.name ?? LOCAL_AGENT_NAMES[agentId]}: {detail}
        </p>
      ) : null}
      {info === undefined ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          The bridge has not reported this agent yet. Refresh in Agents settings.
        </p>
      ) : null}
    </div>
  );
};

/** Agent picker (API key or any local agent), plus the setup details for the current choice. */
export const AgentPicker = () => {
  const backend = useAgentStore((s) => s.backend);
  const localAgentId = useAgentStore((s) => s.localAgentId);
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const setBackend = useAgentStore((s) => s.setBackend);
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const [open, setOpen] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // The runtime may not implement key storage yet in dev; treat that as "no key".
    loadApiKey()
      .then((key) => setHasKey(Boolean(key)))
      .catch(() => setHasKey(false));
  }, []);

  const info = findAgentInfo(agents, localAgentId);
  const status = agentStatus(info, connected);
  const localName = info?.name ?? LOCAL_AGENT_NAMES[localAgentId];

  const pickApi = () => {
    setBackend("api");
    setOpen(false);
  };
  const pickLocal = (id: LocalAgentId) => {
    setLocalAgent(id);
    setBackend("local");
    setOpen(false);
  };

  return (
    <div className="grid gap-2 border-b border-border px-3 py-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={locked}
          aria-label="Agent"
          className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md border border-transparent bg-muted px-2 text-xs text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {backend === "api" ? (
            <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <StatusDot tone={status.tone} />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {backend === "api" ? API_BACKEND_LABEL : localName}
          </span>
          {backend === "local" ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{status.label}</span>
          ) : null}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="max-h-80 overflow-y-auto">
          <div role="listbox" aria-label="Agent" className="grid gap-0.5">
            <button
              type="button"
              role="option"
              aria-selected={backend === "api"}
              onClick={pickApi}
              className={rowClass}
            >
              <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block">{API_BACKEND_LABEL}</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">
                  Runs in this browser with your own key
                </span>
              </span>
              {backend === "api" ? <CheckIcon className="mt-0.5 size-3.5 shrink-0" /> : null}
            </button>
            <div role="separator" className="my-1 h-px bg-border" />
            <LocalAgentOptions onPick={pickLocal} />
          </div>
        </PopoverContent>
      </Popover>

      {backend === "api" ? (
        <div className="flex items-center gap-2 text-xs">
          <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {hasKey ? "Key saved locally" : "No API key set"}
          </span>
          <Button size="xs" variant="secondary" onClick={() => setDialogOpen(true)}>
            {hasKey ? "Replace" : "Add key"}
          </Button>
        </div>
      ) : !connected ? (
        <BridgeSetup />
      ) : (
        <LocalAgentDetails agentId={localAgentId} locked={locked} />
      )}
      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        hasKey={hasKey}
        onChanged={setHasKey}
      />
    </div>
  );
};
