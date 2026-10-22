import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { CopyField } from "@pego/ui/components/copy-field";
import { cn } from "@pego/ui/lib/utils";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { ModelPicker } from "@/panels/agent/ModelPicker";
import { StatusDot } from "@/panels/agent/StatusDot";
import { agentStatus, AGENT_PROVIDER, isRunActive, noteCommand } from "@/panels/agent/agent-format";
import { AgentCard, UseButton } from "@/panels/settings/agent/AgentCard";
import { Section } from "@/panels/settings/agent/Section";

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
    <AgentCard
      provider={AGENT_PROVIDER[id]}
      title={info?.name ?? LOCAL_AGENT_NAMES[id]}
      titleId={`agent-settings-${id}`}
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
          Not installed. See Install an agent below.
        </p>
      ) : null}
    </AgentCard>
  );
};

export const LocalAgentsSection = ({ flashing }: { flashing: boolean }) => (
  <Section
    id="local-agents"
    title="Local agents"
    description="CLIs found on this machine. They use your own login."
    flashing={flashing}
  >
    <div className="grid gap-2">
      {LOCAL_AGENT_IDS.map((id) => (
        <LocalAgentCard key={id} id={id} />
      ))}
    </div>
  </Section>
);
