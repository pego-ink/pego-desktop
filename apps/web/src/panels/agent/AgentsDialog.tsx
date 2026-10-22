import { RefreshCwIcon } from "lucide-react";
import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { Input } from "@pego/ui/components/input";
import { cn } from "@pego/ui/lib/utils";
import {
  findAgentInfo,
  LOCAL_AGENT_NAMES,
  refreshAgents,
  requestModels,
} from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { StatusDot } from "@/panels/agent/StatusDot";
import {
  agentDetail,
  agentStatus,
  API_BACKEND_LABEL,
  isRunActive,
  MODEL_DEFAULT_LABEL,
} from "@/panels/agent/agent-format";

const cell = "px-2 py-1.5 align-top";

const ActiveCell = ({
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
    <Button size="xs" variant="ghost" disabled={disabled} onClick={onUse}>
      Use
    </Button>
  );

const AgentRow = ({ id }: { id: LocalAgentId }) => {
  const info = useAgentStore((s) => findAgentInfo(s.bridge.agents, id));
  const connected = useAgentStore((s) => s.bridge.connected);
  const active = useAgentStore((s) => s.backend === "local" && s.localAgentId === id);
  const model = useAgentStore((s) => s.modelByAgent[id]);
  const models = useAgentStore((s) => s.modelsByAgent[id]?.models);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const setModel = useAgentStore((s) => s.setModel);
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
  const setBackend = useAgentStore((s) => s.setBackend);

  const status = agentStatus(info, connected);
  const detail = agentDetail(id, info, connected);
  const installed = info?.installed === true;
  const listId = `agent-models-${id}`;

  return (
    <tr className={cn("border-t border-border", !status.selectable && "text-muted-foreground")}>
      <td className={cell}>
        <div className="flex items-center gap-2">
          <StatusDot tone={status.tone} />
          <span className="font-medium whitespace-nowrap">
            {info?.name ?? LOCAL_AGENT_NAMES[id]}
          </span>
        </div>
        {detail ? (
          <p className="mt-0.5 pl-3.5 text-[11px] leading-4 text-muted-foreground">{detail}</p>
        ) : null}
      </td>
      <td className={cn(cell, "whitespace-nowrap")}>{status.label}</td>
      <td className={cn(cell, "max-w-40")}>
        <span className="block truncate font-mono text-[11px]" title={info?.path}>
          {info?.path ?? "-"}
        </span>
      </td>
      <td className={cell}>
        {installed && info.supportsModels ? (
          <>
            <Input
              aria-label={`Default model for ${info.name}`}
              placeholder={MODEL_DEFAULT_LABEL}
              list={listId}
              spellCheck={false}
              autoComplete="off"
              className="w-36"
              value={model ?? ""}
              onFocus={() => requestModels(id)}
              onChange={(event) => setModel(id, event.target.value)}
            />
            <datalist id={listId}>
              {(models ?? []).slice(0, 200).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </>
        ) : (
          <span className="text-[11px]">{installed ? "Set by the CLI" : "-"}</span>
        )}
      </td>
      <td className={cn(cell, "text-right")}>
        <ActiveCell
          active={active}
          disabled={!status.selectable || locked}
          onUse={() => {
            setLocalAgent(id);
            setBackend("local");
          }}
        />
      </td>
    </tr>
  );
};

type AgentsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Compact management view of every local agent the bridge knows about. */
export const AgentsDialog = ({ open, onOpenChange }: AgentsDialogProps) => {
  const connected = useAgentStore((s) => s.bridge.connected);
  const refreshing = useAgentStore((s) => s.agentsRefreshing);
  const apiActive = useAgentStore((s) => s.backend === "api");
  const locked = useAgentStore((s) => isRunActive(s.status));
  const setBackend = useAgentStore((s) => s.setBackend);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Agents</DialogTitle>
          <DialogDescription>
            Coding-agent CLIs the local bridge found on this machine. They run with your own login.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <StatusDot tone={connected ? "ready" : "off"} />
          <span className="flex-1">{connected ? "Bridge connected" : "Bridge not running"}</span>
          <Button
            size="xs"
            variant="secondary"
            disabled={!connected || refreshing}
            onClick={() => refreshAgents()}
          >
            <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th className={cn(cell, "font-normal")}>Agent</th>
                <th className={cn(cell, "font-normal")}>Status</th>
                <th className={cn(cell, "font-normal")}>Path</th>
                <th className={cn(cell, "font-normal")}>Default model</th>
                <th className={cn(cell, "text-right font-normal")}>
                  <span className="sr-only">Active</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className={cell}>
                  <span className="font-medium whitespace-nowrap">{API_BACKEND_LABEL}</span>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    Runs in this browser
                  </p>
                </td>
                <td className={cell}>Built in</td>
                <td className={cell}>-</td>
                <td className={cell}>-</td>
                <td className={cn(cell, "text-right")}>
                  <ActiveCell
                    active={apiActive}
                    disabled={locked}
                    onUse={() => setBackend("api")}
                  />
                </td>
              </tr>
              {LOCAL_AGENT_IDS.map((id) => (
                <AgentRow key={id} id={id} />
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
