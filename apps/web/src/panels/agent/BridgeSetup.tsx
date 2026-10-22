import { CopyField } from "@pego/ui/components/copy-field";
import { BRIDGE_COMMAND, MCP_ADD_COMMAND } from "@/panels/agent/agent-format";
import { StatusDot } from "@/panels/agent/StatusDot";

/** How-to shown while the local bridge is not reachable. */
export const BridgeSetup = ({ showStatus = true }: { showStatus?: boolean }) => (
  <div className="grid gap-2">
    {showStatus ? (
      <div className="flex items-center gap-2 text-xs">
        <StatusDot tone="off" />
        <span className="text-foreground">Bridge not running</span>
      </div>
    ) : null}
    <div className="grid gap-1.5">
      <p className="text-[11px] leading-4 text-muted-foreground">
        Start the local bridge from the Pego repo. It finds Claude Code, Codex, opencode, Qwen Code,
        Gemini CLI and Cursor Agent on this machine:
      </p>
      <CopyField value={BRIDGE_COMMAND} />
      <p className="text-[11px] leading-4 text-muted-foreground">
        Optional: connect an MCP client such as Claude Code, so it can also edit this document from
        a terminal:
      </p>
      <CopyField value={MCP_ADD_COMMAND} />
    </div>
  </div>
);
