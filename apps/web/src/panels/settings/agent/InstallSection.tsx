import { LOCAL_AGENT_IDS } from "@pego/agent";
import { CopyField } from "@pego/ui/components/copy-field";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { ProviderLogo } from "@/panels/agent/ProviderLogo";
import { AGENT_PROVIDER, INSTALL_HINTS } from "@/panels/agent/agent-format";
import { Section } from "@/panels/settings/agent/Section";

export const InstallSection = ({ flashing }: { flashing: boolean }) => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const missing = LOCAL_AGENT_IDS.filter(
    (id) => !connected || findAgentInfo(agents, id)?.installed !== true,
  );

  return (
    <Section
      id="install"
      title="Install an agent"
      description="Pego can't install CLIs itself. Run a command in your terminal, then choose Refresh detection."
      flashing={flashing}
    >
      {missing.length === 0 ? (
        <p className="text-xs">Every supported agent is installed.</p>
      ) : (
        <div className="grid gap-2">
          {missing.map((id) => (
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
          ))}
        </div>
      )}
    </Section>
  );
};
