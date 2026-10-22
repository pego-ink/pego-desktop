import { useState, type FormEvent } from "react";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { saveApiKey } from "@/agent/api-key";
import { selectRunsActive, useAgentStore } from "@/agent/use-agent-store";
import { StatusDot } from "@/panels/agent/StatusDot";
import { API_BACKEND_LABEL } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";
import { useHasApiKey } from "@/panels/agent/use-has-api-key";
import { AgentCard, UseButton } from "@/panels/settings/agent/AgentCard";
import { Section } from "@/panels/settings/agent/Section";

type KeyFormProps = {
  hasKey: boolean;
  onDone: (hasKey: boolean | null) => void;
};

const KeyForm = ({ hasKey, onDone }: KeyFormProps) => {
  const [value, setValue] = useState("");
  const key = value.trim();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!key) return;
    if (await safely(() => saveApiKey(key))) onDone(true);
  };

  return (
    <form onSubmit={(event) => void save(event)} className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-label="API key"
          placeholder="sk-ant-…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="xs" disabled={key.length === 0}>
          {hasKey ? "Replace" : "Save"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Saved locally in this browser and only sent to api.anthropic.com. Create one at{" "}
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          console.anthropic.com
        </a>
        .
      </p>
    </form>
  );
};

export const ApiKeySection = ({ flashing }: { flashing: boolean }) => {
  const [hasKey, setHasKey] = useHasApiKey();
  const active = useAgentStore((s) => s.backend === "api");
  const locked = useAgentStore((s) => selectRunsActive(s) > 0);
  const setBackend = useAgentStore((s) => s.setBackend);
  const [editing, setEditing] = useState(false);

  const remove = async () => {
    if (await safely(() => saveApiKey(null))) setHasKey(false);
  };

  return (
    <Section
      id="api-key"
      title="API key"
      description="Runs in this browser and calls api.anthropic.com with your own key."
      flashing={flashing}
    >
      <AgentCard
        provider="anthropic"
        title={API_BACKEND_LABEL}
        titleId="agent-settings-api-card"
        action={<UseButton active={active} disabled={locked} onUse={() => setBackend("api")} />}
      >
        <div className="flex items-center gap-2 text-xs">
          <StatusDot tone={hasKey ? "ready" : "warn"} />
          <span className="min-w-0 flex-1 truncate">
            {hasKey ? "Key saved locally" : "No API key set"}
          </span>
          {hasKey ? (
            <Button
              size="xs"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : null}
          {editing ? null : (
            <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
              {hasKey ? "Replace key" : "Add key"}
            </Button>
          )}
        </div>
        {editing ? (
          <KeyForm
            hasKey={hasKey}
            onDone={(next) => {
              if (next !== null) setHasKey(next);
              setEditing(false);
            }}
          />
        ) : null}
      </AgentCard>
    </Section>
  );
};
