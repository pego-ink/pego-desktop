import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { bridgeHttpUrl } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { Section } from "@/panels/settings/agent/Section";

/** The bridge's port, as the extension needs it (?bridge= in the URL, else the default). */
const bridgePort = (): string => new URL(bridgeHttpUrl("/")).port;

/**
 * Settings › Agent & Models › Browser extension: the pairing code the Pego extension needs to
 * send pages, picked elements and screenshots to this editor (through the bridge).
 */
export const ExtensionSection = ({ flashing }: { flashing: boolean }) => {
  const connected = useAgentStore((s) => s.bridge.connected);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    void fetch(bridgeHttpUrl("/extension/token"))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { token?: unknown };
        if (live && typeof body.token === "string") setCode(body.token);
      })
      .catch(() => {
        if (live) setError("The bridge did not give a pairing code. Update and restart it.");
      });
    return () => {
      live = false;
    };
  }, [connected]);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Section
      id="extension"
      title="Browser extension"
      description="Send any web page, an element of it, or a screenshot from Chrome to the canvas as layers."
      flashing={flashing}
    >
      <div className="grid gap-2 rounded-lg border border-border p-3 text-xs">
        {!connected ? (
          <p className="text-muted-foreground">Start the bridge to pair the extension.</p>
        ) : error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Pairing code</span>
              <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-1.5 py-1 font-mono text-[11px]">
                {code ? (shown ? code : "•".repeat(24)) : "…"}
              </code>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={shown ? "Hide the pairing code" : "Show the pairing code"}
                onClick={() => setShown((value) => !value)}
                disabled={!code}
              >
                {shown ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Copy the pairing code"
                onClick={() => void copy()}
                disabled={!code}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <div className="text-muted-foreground">
              Bridge port <code className="font-mono text-foreground">{bridgePort()}</code>
            </div>
          </>
        )}
        <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
          <li>
            Build it:{" "}
            <code className="font-mono text-foreground">bun run --cwd apps/extension build</code>
          </li>
          <li>
            In Chrome, open <code className="font-mono text-foreground">chrome://extensions</code>,
            turn on Developer mode, choose Load unpacked and pick{" "}
            <code className="font-mono text-foreground">apps/extension/dist</code>.
          </li>
          <li>Open the Pego extension, paste the pairing code (and the port if it is not 4519).</li>
        </ol>
        <p className="text-muted-foreground">
          Keep the code private: anything with it can add content to your canvas.
        </p>
      </div>
    </Section>
  );
};
