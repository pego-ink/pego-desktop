import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PLANNER_MODEL } from "@/agent/api-runtime";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "@/agent/local-agents";
import { useCustomProviders } from "@/panels/agent/custom-provider/use-custom-providers";
import { useAgentStore } from "@/agent/use-agent-store";
import { ModelPicker } from "@/panels/agent/ModelPicker";
import { API_BACKEND_LABEL, isRunActive } from "@/panels/agent/agent-format";
import { Section } from "@/panels/settings/agent/Section";

const API_VALUE = "api";
const LOCAL_PREFIX = "local:";
const CUSTOM_PREFIX = "custom:";

/** Backend, agent and model the composer starts runs with. */
export const DefaultAgentSection = ({ flashing }: { flashing: boolean }) => {
  const backend = useAgentStore((s) => s.backend);
  const localAgentId = useAgentStore((s) => s.localAgentId);
  const customId = useAgentStore((s) => s.customProviderId);
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const setBackend = useAgentStore((s) => s.setBackend);
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
  const setCustomProvider = useAgentStore((s) => s.setCustomProvider);
  const { providers } = useCustomProviders();

  const value =
    backend === "api"
      ? API_VALUE
      : backend === "local"
        ? `${LOCAL_PREFIX}${localAgentId}`
        : `${CUSTOM_PREFIX}${customId ?? ""}`;

  const onChange = (next: string) => {
    if (next === API_VALUE) return setBackend("api");
    if (next.startsWith(LOCAL_PREFIX)) {
      setLocalAgent(next.slice(LOCAL_PREFIX.length) as LocalAgentId);
      return setBackend("local");
    }
    if (next.startsWith(CUSTOM_PREFIX)) setCustomProvider(next.slice(CUSTOM_PREFIX.length));
  };

  const customProvider = providers.find((p) => p.id === customId);
  const info = findAgentInfo(agents, localAgentId);
  const installed = connected && info?.installed === true;

  return (
    <Section
      id="default"
      title="Default agent & model"
      description="What the composer uses for new runs. You can still switch from the composer."
      flashing={flashing}
    >
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-3 text-xs">
          <label htmlFor="agent-default-select" className="flex-1 text-muted-foreground">
            Agent
          </label>
          <div className="w-44 shrink-0">
            <NativeSelect
              id="agent-default-select"
              value={value}
              disabled={locked}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value={API_VALUE}>{API_BACKEND_LABEL}</option>
              <optgroup label="Local agents">
                {LOCAL_AGENT_IDS.map((id) => (
                  <option
                    key={id}
                    value={`${LOCAL_PREFIX}${id}`}
                    disabled={!(connected && findAgentInfo(agents, id)?.installed === true)}
                  >
                    {findAgentInfo(agents, id)?.name ?? LOCAL_AGENT_NAMES[id]}
                  </option>
                ))}
              </optgroup>
              {providers.length > 0 ? (
                <optgroup label="Custom providers">
                  {providers.map((provider) => (
                    <option key={provider.id} value={`${CUSTOM_PREFIX}${provider.id}`}>
                      {provider.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </NativeSelect>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex-1 text-muted-foreground">Model</span>
          {backend === "local" && installed && info?.supportsModels ? (
            <ModelPicker agentId={localAgentId} disabled={locked} />
          ) : backend === "local" ? (
            <span className="text-[11px] text-muted-foreground">
              {installed ? "The CLI picks its own model." : "Agent not detected."}
            </span>
          ) : backend === "custom" ? (
            <span
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
              title={customProvider?.executorModel}
            >
              {customProvider?.executorModel ?? "Provider not found"}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">{PLANNER_MODEL}</span>
          )}
        </div>
      </div>
    </Section>
  );
};
