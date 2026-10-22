import { useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { loadApiKey } from "@/agent/api-key";
import { useAgentStore, type AgentBackend } from "@/agent/use-agent-store";
import { ApiKeyDialog } from "@/panels/agent/ApiKeyDialog";
import { ClaudeCodeSetup } from "@/panels/agent/ClaudeCodeSetup";
import { isRunActive } from "@/panels/agent/agent-format";

const OPTIONS = [
  { value: "api", label: "API key" },
  { value: "claude-code", label: "Claude Code (local)" },
] as const;

export const BackendSwitch = () => {
  const backend = useAgentStore((s) => s.backend);
  const setBackend = useAgentStore((s) => s.setBackend);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const [hasKey, setHasKey] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // The runtime may not implement key storage yet in dev; treat that as "no key".
    loadApiKey()
      .then((key) => setHasKey(Boolean(key)))
      .catch(() => setHasKey(false));
  }, []);

  return (
    <div className="grid gap-2 border-b border-border px-3 py-2">
      <fieldset disabled={locked} className="contents">
        <SegmentedControl<AgentBackend>
          aria-label="Agent backend"
          value={backend}
          options={OPTIONS}
          onChange={setBackend}
        />
      </fieldset>
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
      ) : (
        <ClaudeCodeSetup />
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
