import { Button } from "@pego/ui/components/button";
import { CopyField } from "@pego/ui/components/copy-field";
import { cn } from "@pego/ui/lib/utils";
import { takeOverBridge } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { BRIDGE_COMMAND, MCP_ADD_COMMAND } from "@/panels/agent/agent-format";

export const ClaudeCodeSetup = () => {
  const connected = useAgentStore((s) => s.bridge.connected);
  const available = useAgentStore((s) => s.bridge.claudeCodeAvailable);
  const replaced = useAgentStore((s) => s.bridge.replaced);

  if (replaced) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />
          <span className="text-foreground">Connected in another Pego window</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Claude Code edits one window at a time. Switch it to this one to use it here.
        </p>
        <Button variant="secondary" size="xs" onClick={() => takeOverBridge()}>
          Use this window
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-emerald-400" : "bg-muted-foreground/50",
          )}
        />
        <span className="text-foreground">
          {connected ? "Bridge connected" : "Bridge not running"}
        </span>
        {connected && !available ? (
          <span className="text-muted-foreground">· no Claude Code login found</span>
        ) : null}
      </div>
      {connected ? null : (
        <div className="grid gap-1.5">
          <p className="text-[11px] leading-4 text-muted-foreground">
            Start the local bridge from the Pego repo:
          </p>
          <CopyField value={BRIDGE_COMMAND} />
          <p className="text-[11px] leading-4 text-muted-foreground">
            Then connect Claude Code, so it can also edit this document from a terminal:
          </p>
          <CopyField value={MCP_ADD_COMMAND} />
        </div>
      )}
    </div>
  );
};
