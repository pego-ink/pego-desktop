import { useState } from "react";
import { PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import type { CustomProvider } from "@/agent/providers/types";
import { selectRunsActive, useAgentStore } from "@/agent/use-agent-store";
import { ProviderForm } from "@/panels/agent/custom-provider/ProviderForm";
import { KIND_LABEL, providerSummary } from "@/panels/agent/custom-provider/provider-form";
import {
  removeProvider,
  useCustomProviders,
} from "@/panels/agent/custom-provider/use-custom-providers";
import { safely } from "@/panels/agent/run-actions";
import { Section } from "@/panels/settings/agent/Section";

const ProviderRow = ({
  provider,
  onEdit,
}: {
  provider: CustomProvider;
  onEdit: (provider: CustomProvider) => void;
}) => {
  const active = useAgentStore((s) => s.backend === "custom" && s.customProviderId === provider.id);
  const locked = useAgentStore((s) => selectRunsActive(s) > 0);
  const setCustomProvider = useAgentStore((s) => s.setCustomProvider);
  const [confirming, setConfirming] = useState(false);
  const titleId = `cp-${provider.id}`;

  return (
    <section aria-labelledby={titleId} className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <ServerIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <h4 id={titleId} className="min-w-0 truncate text-xs font-medium">
          {provider.name}
        </h4>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {KIND_LABEL[provider.kind]}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {active ? (
            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-foreground">
              Active
            </span>
          ) : (
            <Button
              size="xs"
              variant="secondary"
              disabled={locked}
              onClick={() => setCustomProvider(provider.id)}
            >
              Use
            </Button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={provider.baseUrl}>
          {providerSummary(provider)}
        </span>
        <span className="min-w-0 truncate font-mono" title={provider.executorModel}>
          {provider.executorModel}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1">
        {confirming ? (
          <>
            <span className="mr-auto text-[11px] text-muted-foreground">
              Delete this provider and its key?
            </span>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => void safely(() => removeProvider(provider.id))}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Edit ${provider.name}`}
              onClick={() => onEdit(provider)}
            >
              <PencilIcon aria-hidden />
              Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Delete ${provider.name}`}
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden />
              Delete
            </Button>
          </>
        )}
      </div>
    </section>
  );
};

type CustomProvidersSectionProps = {
  /** Open the add form (from the composer's "Add provider…"). */
  startAdding: boolean;
  flashing: boolean;
};

/** The form is closed, adding a provider, or editing one. */
type FormState = { mode: "closed" } | { mode: "add" } | { mode: "edit"; provider: CustomProvider };

/** The user's own OpenAI- and Anthropic-compatible providers, with the add/edit form inline. */
export const CustomProvidersSection = ({ startAdding, flashing }: CustomProvidersSectionProps) => {
  const { providers, loaded } = useCustomProviders();
  const [form, setForm] = useState<FormState>({ mode: "closed" });

  // Open the form when a deep link asks for it (adjusting state during render, not in an effect).
  const [seenAdding, setSeenAdding] = useState(false);
  if (startAdding !== seenAdding) {
    setSeenAdding(startAdding);
    if (startAdding) setForm({ mode: "add" });
  }

  const close = () => setForm({ mode: "closed" });

  return (
    <Section
      id="custom-providers"
      title="Custom providers"
      description="Your own OpenAI- or Anthropic-compatible endpoints."
      flashing={flashing}
      action={
        form.mode === "add" ? null : (
          <Button size="xs" variant="secondary" onClick={() => setForm({ mode: "add" })}>
            <PlusIcon aria-hidden />
            Add provider
          </Button>
        )
      }
    >
      {form.mode === "closed" ? null : (
        <ProviderForm
          key={form.mode === "edit" ? form.provider.id : "add"}
          editing={form.mode === "edit" ? form.provider : null}
          onClose={close}
        />
      )}
      {providers.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          onEdit={(editing) => setForm({ mode: "edit", provider: editing })}
        />
      ))}
      {loaded && providers.length === 0 && form.mode === "closed" ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Add OpenRouter, DeepSeek, Groq, a local Ollama or LM Studio server, or any
          Anthropic-compatible gateway.
        </p>
      ) : null}
    </Section>
  );
};
