import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { NativeSelect } from "@pego/ui/components/native-select";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { fetchProviderModels } from "@/agent/providers/models";
import { loadProviderKey } from "@/agent/providers/store";
import type { CustomProvider, CustomProviderKind } from "@/agent/providers/types";
import { checkBaseUrl } from "@/agent/provider-url";
import { persistProvider } from "@/panels/agent/custom-provider/use-custom-providers";
import {
  BASE_URL_PLACEHOLDER,
  draftFromProvider,
  emptyDraft,
  KIND_OPTIONS,
  mergeModels,
  PROVIDER_PRESETS,
  validateDraft,
  type DraftErrors,
  type ProviderDraft,
} from "@/panels/agent/custom-provider/provider-form";
import { safely } from "@/panels/agent/run-actions";

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
};

const Field = ({ label, htmlFor, error, hint, children }: FieldProps) => (
  <div className="grid gap-1">
    <label htmlFor={htmlFor} className="text-[11px] font-medium text-muted-foreground">
      {label}
    </label>
    {children}
    {error ? (
      <p role="alert" className="text-[11px] text-destructive">
        {error}
      </p>
    ) : hint ? (
      <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>
    ) : null}
  </div>
);

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; count: number; applied: boolean }
  | { status: "error"; message: string };

type ProviderFormProps = {
  /** Provider to edit; null adds a new one. */
  editing: CustomProvider | null;
  onClose: () => void;
};

/** Inline add/edit form. Mount it per use so each starts from a clean draft. */
export const ProviderForm = ({ editing, onClose }: ProviderFormProps) => {
  const uid = useId();
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    editing ? draftFromProvider(editing) : emptyDraft(),
  );
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  // Only whether a key exists is kept in state; its value is read again when needed.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    loadProviderKey(editing.id)
      .then((key) => !cancelled && setHasSavedKey(Boolean(key)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editing]);

  const patch = (next: Partial<ProviderDraft>) => setDraft((current) => ({ ...current, ...next }));

  const effectiveSavedKey = hasSavedKey && !removeKey;
  const result = validateDraft(draft, { hasSavedKey: effectiveSavedKey });
  const errors: DraftErrors = submitted && !result.ok ? result.errors : {};

  const onPreset = (id: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    patch({
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      name: draft.name.trim() ? draft.name : preset.label.replace(/ \(local\)$/, ""),
      models: [],
    });
    setFetchState({ status: "idle" });
  };

  const runFetch = async (apply: boolean) => {
    const url = checkBaseUrl(draft.baseUrl);
    if ("error" in url) {
      setFetchState({ status: "error", message: url.error });
      return;
    }
    setFetchState({ status: "loading" });
    try {
      const key =
        draft.apiKey.trim() ||
        (editing && effectiveSavedKey ? ((await loadProviderKey(editing.id)) ?? "") : "");
      const models = await fetchProviderModels(draft.kind, url.url, key);
      if (apply) patch({ models: mergeModels(models) });
      setFetchState({ status: "ok", count: models.length, applied: apply });
    } catch (error) {
      setFetchState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not fetch models.",
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!result.ok) return;
    const typedKey = draft.apiKey.trim();
    const provider: CustomProvider = {
      ...result.value,
      id: editing?.id ?? crypto.randomUUID(),
      createdAt: editing?.createdAt ?? Date.now(),
    };
    // undefined keeps the saved key, null removes it, a string replaces it.
    const key = typedKey ? typedKey : removeKey ? null : undefined;
    setSaving(true);
    const saved = await safely(() => persistProvider(provider, key));
    setSaving(false);
    if (saved) onClose();
  };

  const loading = fetchState.status === "loading";
  const kind: CustomProviderKind = draft.kind;
  const listId = `${uid}-models`;

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label={editing ? "Edit provider" : "Add provider"}
      className="grid gap-3 rounded-lg border border-border p-3"
    >
      <div className="grid gap-0.5">
        <h4 className="text-xs font-medium">{editing ? "Edit provider" : "Add provider"}</h4>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Use any OpenAI- or Anthropic-compatible endpoint. Requests go straight from this browser
          to the base URL you enter.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Type</span>
          <SegmentedControl
            aria-label="Provider type"
            value={kind}
            options={KIND_OPTIONS}
            onChange={(next) => {
              patch({ kind: next, models: [] });
              setFetchState({ status: "idle" });
            }}
          />
        </div>
        <Field label="Name" htmlFor={`${uid}-name`} error={errors.name}>
          <Input
            id={`${uid}-name`}
            autoFocus
            autoComplete="off"
            placeholder="OpenRouter"
            value={draft.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field
          label="Base URL"
          htmlFor={`${uid}-url`}
          error={errors.baseUrl}
          hint={
            kind === "anthropic-compatible"
              ? "The gateway root that serves /v1/messages."
              : "Include the version path, for example /v1."
          }
        >
          <div className="flex items-center gap-1.5">
            <Input
              id={`${uid}-url`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={BASE_URL_PLACEHOLDER[kind]}
              value={draft.baseUrl}
              aria-invalid={Boolean(errors.baseUrl)}
              onChange={(event) => patch({ baseUrl: event.target.value })}
              className="min-w-0 flex-1"
            />
            {kind === "openai-compatible" ? (
              <div className="w-28 shrink-0">
                <NativeSelect
                  aria-label="Base URL preset"
                  value=""
                  onChange={(event) => onPreset(event.target.value)}
                >
                  <option value="">Presets</option>
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </div>
        </Field>
        <Field
          label="API key"
          htmlFor={`${uid}-key`}
          error={errors.apiKey}
          hint={
            effectiveSavedKey
              ? "A key is saved in this browser. Type a new one to replace it."
              : "Saved in this browser only and sent only to the base URL above. Optional for localhost."
          }
        >
          <div className="flex items-center gap-1.5">
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={effectiveSavedKey ? "Saved. Leave empty to keep" : "Paste key"}
              value={draft.apiKey}
              aria-invalid={Boolean(errors.apiKey)}
              onChange={(event) => patch({ apiKey: event.target.value })}
              className="min-w-0 flex-1"
            />
            {effectiveSavedKey ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setRemoveKey(true)}
              >
                Remove key
              </Button>
            ) : null}
          </div>
          {removeKey ? (
            <p className="text-[11px] text-muted-foreground">The saved key is removed on save.</p>
          ) : null}
        </Field>
        <div className="grid gap-1">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={loading}
              onClick={() => void runFetch(true)}
            >
              Fetch models
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={loading}
              onClick={() => void runFetch(false)}
            >
              Test connection
            </Button>
            <span
              role="status"
              aria-live="polite"
              className="min-w-0 truncate text-[11px] text-muted-foreground"
            >
              {fetchState.status === "loading" ? "Contacting provider…" : null}
              {fetchState.status === "ok"
                ? fetchState.applied
                  ? `${fetchState.count} models found`
                  : `Connected. ${fetchState.count} models available`
                : null}
            </span>
          </div>
          {fetchState.status === "error" ? (
            <p role="alert" className="text-[11px] text-destructive">
              {fetchState.message}
            </p>
          ) : null}
        </div>
        <datalist id={listId}>
          {draft.models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <Field
          label="Executor model"
          htmlFor={`${uid}-exec`}
          error={errors.executorModel}
          hint="Runs each step with the tools. Pick a fetched model or type an id."
        >
          <Input
            id={`${uid}-exec`}
            list={listId}
            autoComplete="off"
            spellCheck={false}
            placeholder="model-id"
            value={draft.executorModel}
            aria-invalid={Boolean(errors.executorModel)}
            onChange={(event) => patch({ executorModel: event.target.value })}
          />
        </Field>
        <Field
          label="Planner model (optional)"
          htmlFor={`${uid}-plan`}
          error={errors.plannerModel}
          hint="Writes the plan first. Leave empty to use the executor."
        >
          <Input
            id={`${uid}-plan`}
            list={listId}
            autoComplete="off"
            spellCheck={false}
            placeholder="Same as executor"
            value={draft.plannerModel}
            aria-invalid={Boolean(errors.plannerModel)}
            onChange={(event) => patch({ plannerModel: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {editing ? "Save changes" : "Add provider"}
        </Button>
      </div>
    </form>
  );
};
