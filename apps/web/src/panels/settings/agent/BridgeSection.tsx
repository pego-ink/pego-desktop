import { RefreshCwIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { refreshAgents } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { BridgeSetup } from "@/panels/agent/BridgeSetup";
import { StatusDot } from "@/panels/agent/StatusDot";
import { Section } from "@/panels/settings/agent/Section";

export const BridgeSection = ({ flashing }: { flashing: boolean }) => {
  const connected = useAgentStore((s) => s.bridge.connected);
  const refreshing = useAgentStore((s) => s.agentsRefreshing);

  return (
    <Section
      id="bridge"
      title="Bridge status"
      description="The local bridge lets Pego detect and run the CLIs above."
      flashing={flashing}
    >
      <div className="grid gap-2 rounded-xl border border-border p-3">
        <div className="flex items-center gap-2 text-[13px]">
          <StatusDot tone={connected ? "ready" : "off"} />
          <span className="flex-1">{connected ? "Bridge connected" : "Bridge not running"}</span>
          <Button
            size="xs"
            variant="secondary"
            disabled={!connected || refreshing}
            onClick={() => refreshAgents()}
          >
            <RefreshCwIcon aria-hidden className={cn(refreshing && "motion-safe:animate-spin")} />
            Refresh detection
          </Button>
        </div>
        {connected ? null : <BridgeSetup showStatus={false} />}
      </div>
    </Section>
  );
};
