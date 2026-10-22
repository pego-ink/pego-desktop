import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";
import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { PLANNER_MODEL } from "@/agent/api-runtime";
import { findAgentInfo, LOCAL_AGENT_NAMES, requestModels } from "@/agent/local-agents";
import { useAgentStore, useVisibleRun } from "@/agent/use-agent-store";
import {
  isValidModelId,
  KIND_LABEL,
  withExecutorModel,
} from "@/panels/agent/custom-provider/provider-form";
import {
  persistProvider,
  useCustomProviders,
  useProviderReady,
} from "@/panels/agent/custom-provider/use-custom-providers";
import type { CustomProvider } from "@/agent/providers/types";
import { ModelList, ModelOptions } from "@/panels/agent/ModelList";
import { safely } from "@/panels/agent/run-actions";
import { ProviderLogo } from "@/panels/agent/ProviderLogo";
import { StatusDot } from "@/panels/agent/StatusDot";
import { navigateList } from "@/panels/agent/list-nav";
import { useHasApiKey } from "@/panels/agent/use-has-api-key";
import { useSettingsModal } from "@/store/use-settings-store";
import {
  agentDetail,
  agentStatus,
  AGENT_PROVIDER,
  isRunActive,
  pillModel,
  pillTitle,
  type AgentStatusTone,
} from "@/panels/agent/agent-format";

const rowClass =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";

type MenuRowProps = {
  role: "menuitemradio" | "menuitem";
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: ReactNode;
  /** Muted small text after the title (version, provider). */
  badge?: string;
  /** Long note kept out of the row: shown as the row tooltip. */
  tooltip?: string | null;
  /** Amber dot after the badge, for notes that need attention. */
  warn?: boolean;
  trailing?: ReactNode;
};

const MenuRow = ({
  role,
  checked,
  disabled,
  onClick,
  icon,
  title,
  badge,
  tooltip,
  warn,
  trailing,
}: MenuRowProps) => (
  <button
    data-nav
    type="button"
    role={role}
    aria-checked={role === "menuitemradio" ? checked === true : undefined}
    aria-description={tooltip ?? undefined}
    title={tooltip ?? undefined}
    disabled={disabled}
    onClick={onClick}
    className={cn(rowClass, checked && "bg-accent/60")}
  >
    <span className="flex shrink-0">{icon}</span>
    <span className="min-w-0 truncate">{title}</span>
    {badge ? (
      <span className="min-w-0 shrink-[2] truncate text-[11px] text-muted-foreground">{badge}</span>
    ) : null}
    {warn ? <StatusDot tone="warn" /> : null}
    <span className="ml-auto flex shrink-0 items-center">{trailing}</span>
  </button>
);

const Separator = () => <div role="separator" className="my-0.5 h-px bg-border" />;

/** Which model list the popover is showing: a local agent's or a custom provider's. */
type ModelsTarget = { kind: "local"; id: LocalAgentId } | { kind: "custom"; id: string };

type AgentMenuProps = {
  hasKey: boolean;
  onClose: () => void;
  onModels: (target: ModelsTarget) => void;
  onSettings: (section?: string) => void;
};

const AgentMenu = ({ hasKey, onClose, onModels, onSettings }: AgentMenuProps) => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const backend = useAgentStore((s) => s.backend);
  const activeId = useAgentStore((s) => s.localAgentId);
  const setBackend = useAgentStore((s) => s.setBackend);
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
  const setCustomProvider = useAgentStore((s) => s.setCustomProvider);
  const customId = useAgentStore((s) => s.customProviderId);
  const { providers } = useCustomProviders();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target =
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ??
      menuRef.current?.querySelector<HTMLElement>("[data-nav]:not(:disabled)");
    target?.focus();
  }, []);

  const pickApi = () => {
    setBackend("api");
    onClose();
  };

  const pickLocal = (id: LocalAgentId) => {
    setLocalAgent(id);
    setBackend("local");
    const info = findAgentInfo(agents, id);
    // Models-capable agents continue straight to the model choice.
    if (connected && info?.installed && info.supportsModels) {
      requestModels(id);
      onModels({ kind: "local", id });
      return;
    }
    onClose();
  };

  // A custom provider always has a model to choose, so selecting one continues to its models.
  const pickCustom = (id: string) => {
    setCustomProvider(id);
    onModels({ kind: "custom", id });
  };

  return (
    <div ref={menuRef} role="menu" aria-label="Agent" onKeyDown={navigateList} className="grid">
      <MenuRow
        role="menuitemradio"
        checked={backend === "api"}
        onClick={pickApi}
        icon={<ProviderLogo provider="anthropic" />}
        title="API key"
        badge="Anthropic"
        warn={!hasKey}
        tooltip={hasKey ? null : "No key yet. Add one in Model settings"}
        trailing={backend === "api" ? <CheckIcon aria-hidden className="size-3.5" /> : null}
      />
      <Separator />
      {LOCAL_AGENT_IDS.map((id) => {
        const info = findAgentInfo(agents, id);
        const status = agentStatus(info, connected);
        const active = backend === "local" && id === activeId;
        const hasModels = connected && info?.installed === true && info.supportsModels;
        return (
          <MenuRow
            key={id}
            role="menuitemradio"
            checked={active}
            disabled={!status.selectable}
            onClick={() => pickLocal(id)}
            icon={<ProviderLogo provider={AGENT_PROVIDER[id]} />}
            title={info?.name ?? LOCAL_AGENT_NAMES[id]}
            badge={connected ? status.label : undefined}
            warn={status.tone === "warn"}
            tooltip={agentDetail(id, info, connected)}
            trailing={
              <span className="flex items-center gap-1 text-muted-foreground">
                {active ? <CheckIcon aria-hidden className="size-3.5 text-foreground" /> : null}
                {hasModels ? <ChevronRightIcon aria-hidden className="size-3.5" /> : null}
              </span>
            }
          />
        );
      })}
      {connected ? null : (
        <MenuRow
          role="menuitem"
          onClick={() => onSettings("bridge")}
          icon={<StatusDot tone="off" />}
          title="Bridge not running"
          badge="Set up"
        />
      )}
      {providers.length > 0 ? (
        <>
          <Separator />
          <div className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">Custom</div>
          {providers.map((provider) => {
            const active = backend === "custom" && customId === provider.id;
            return (
              <MenuRow
                key={provider.id}
                role="menuitemradio"
                checked={active}
                onClick={() => pickCustom(provider.id)}
                icon={<ServerIcon aria-hidden className="size-3.5 text-muted-foreground" />}
                title={provider.name}
                badge={KIND_LABEL[provider.kind]}
                trailing={
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {active ? <CheckIcon aria-hidden className="size-3.5 text-foreground" /> : null}
                    <ChevronRightIcon aria-hidden className="size-3.5" />
                  </span>
                }
              />
            );
          })}
        </>
      ) : null}
      <Separator />
      <MenuRow
        role="menuitem"
        onClick={() => onSettings("add-provider")}
        icon={<PlusIcon aria-hidden className="size-3.5 text-muted-foreground" />}
        title="Add provider…"
      />
      <MenuRow
        role="menuitem"
        onClick={() => onSettings()}
        icon={<Settings2Icon aria-hidden className="size-3.5 text-muted-foreground" />}
        title="Model settings…"
      />
    </div>
  );
};

type ModelsViewProps = {
  agentId: LocalAgentId;
  onBack: () => void;
  onDone: () => void;
};

const ModelsView = ({ agentId, onBack, onDone }: ModelsViewProps) => {
  const info = useAgentStore((s) => findAgentInfo(s.bridge.agents, agentId));
  const setModel = useAgentStore((s) => s.setModel);
  return (
    <div className="grid gap-0.5">
      <button
        type="button"
        aria-label="Back to agents"
        onClick={onBack}
        className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <ChevronLeftIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <ProviderLogo provider={AGENT_PROVIDER[agentId]} />
        <span className="min-w-0 flex-1 truncate">{info?.name ?? LOCAL_AGENT_NAMES[agentId]}</span>
        <span className="text-[11px] text-muted-foreground">Model</span>
      </button>
      <div role="separator" className="my-0.5 h-px bg-border" />
      <ModelList
        agentId={agentId}
        onPick={(model) => {
          setModel(agentId, model);
          onDone();
        }}
      />
    </div>
  );
};

type CustomModelsViewProps = {
  providerId: string;
  onBack: () => void;
  onDone: () => void;
};

/** Models of one custom provider; picking one makes it the provider's executor model. */
const CustomModelsView = ({ providerId, onBack, onDone }: CustomModelsViewProps) => {
  const provider = useCustomProviders().providers.find((p) => p.id === providerId);
  const pick = async (current: CustomProvider, model: string | undefined) => {
    if (!model) return;
    const saved = await safely(() => persistProvider(withExecutorModel(current, model), undefined));
    if (saved) onDone();
  };
  return (
    <div className="grid gap-0.5">
      <button
        type="button"
        aria-label="Back to agents"
        onClick={onBack}
        className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <ChevronLeftIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <ServerIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{provider?.name ?? "Custom provider"}</span>
        <span className="text-[11px] text-muted-foreground">Model</span>
      </button>
      <div role="separator" className="my-0.5 h-px bg-border" />
      {provider ? (
        <ModelOptions
          models={provider.models}
          selected={provider.executorModel}
          onPick={(model) => void pick(provider, model)}
          allowDefault={false}
          loaded
          emptyNote="No models saved. Type a model id above."
          acceptCustom={isValidModelId}
        />
      ) : null}
    </div>
  );
};

type AgentSelectorProps = {
  /** Where focus goes after the popover closes (the prompt box). */
  restoreFocusRef: RefObject<HTMLElement | null>;
};

/** Composer pill: current agent + model, with a popover to switch; settings open in the Agent & Models tab. */
export const AgentSelector = ({ restoreFocusRef }: AgentSelectorProps) => {
  const backend = useAgentStore((s) => s.backend);
  const localAgentId = useAgentStore((s) => s.localAgentId);
  const info = useAgentStore((s) => findAgentInfo(s.bridge.agents, s.localAgentId));
  const connected = useAgentStore((s) => s.bridge.connected);
  const model = useAgentStore((s) => s.modelByAgent[s.localAgentId]);
  const customId = useAgentStore((s) => s.customProviderId);
  const { providers } = useCustomProviders();
  const customProvider =
    backend === "custom" ? providers.find((p) => p.id === customId) : undefined;
  const customReady = useProviderReady(customProvider);
  const locked = useVisibleRun((s) => isRunActive(s.status));
  const [hasKey] = useHasApiKey();
  const [open, setOpen] = useState(false);
  const [modelsFor, setModelsFor] = useState<ModelsTarget | null>(null);
  const opensSettings = useRef(false);
  // View swap: the outgoing menu height becomes the model list's min-height (no shrink-snap), and
  // swapped views fade in over 100ms. The first view of an open popover does not animate.
  const viewRef = useRef<HTMLDivElement>(null);
  const [swap, setSwap] = useState({ animate: false, minHeight: 0 });

  const status = agentStatus(info, connected);
  const isApi = backend === "api";
  const isCustom = backend === "custom";
  const name = isCustom
    ? (customProvider?.name ?? "Custom provider")
    : isApi
      ? "API key"
      : (info?.name ?? LOCAL_AGENT_NAMES[localAgentId]);
  const pill = pillModel(
    isCustom
      ? customProvider?.executorModel
      : isApi
        ? PLANNER_MODEL
        : info?.supportsModels
          ? model
          : undefined,
  );
  const tone: AgentStatusTone = isCustom
    ? customReady
      ? "ready"
      : "warn"
    : isApi
      ? hasKey
        ? "ready"
        : "warn"
      : status.tone;
  const stateLabel = isCustom
    ? customReady
      ? ""
      : customProvider
        ? "no key"
        : ""
    : isApi
      ? hasKey
        ? ""
        : "no key"
      : tone === "ready"
        ? ""
        : status.label;
  const fullTitle = pillTitle(name, pill);
  const accessibleName = [`Agent: ${fullTitle}`, stateLabel || null].filter(Boolean).join(", ");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setSwap({ animate: false, minHeight: 0 });
    setModelsFor(null);
  };

  const showModels = (target: ModelsTarget | null) => {
    setSwap({ animate: true, minHeight: target ? (viewRef.current?.offsetHeight ?? 0) : 0 });
    setModelsFor(target);
  };

  const openSettings = (section?: string) => {
    opensSettings.current = true;
    setOpen(false);
    useSettingsModal.getState().openSettings("agent", section);
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    restoreFocusRef.current?.focus();
  };

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          disabled={locked}
          aria-label={accessibleName}
          title={locked ? "Agent can't change while a run is active" : fullTitle}
          className="flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          {isCustom ? (
            <ServerIcon aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <ProviderLogo provider={isApi ? "anthropic" : AGENT_PROVIDER[localAgentId]} />
          )}
          {/* "Default" adds nothing visible: the logo alone says which agent; the title has the rest. */}
          {pill.isDefault && !isCustom ? null : (
            <span className="max-w-[140px] min-w-0 truncate text-foreground">{pill.label}</span>
          )}
          {tone === "ready" ? null : <StatusDot tone={tone} />}
          <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (modelsFor === null) return;
            event.preventDefault();
            showModels(null);
          }}
          onCloseAutoFocus={(event) => {
            if (opensSettings.current) {
              opensSettings.current = false;
              event.preventDefault();
              return;
            }
            restoreFocus(event);
          }}
          onKeyDown={(event) => {
            if (modelsFor === null || event.key !== "ArrowLeft") return;
            if (event.target instanceof HTMLInputElement) return;
            event.preventDefault();
            showModels(null);
          }}
          className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[280px] max-w-[calc(100vw-1rem)] p-1 overflow-y-auto"
        >
          <div
            key={modelsFor ? `${modelsFor.kind}:${modelsFor.id}` : "menu"}
            ref={viewRef}
            style={modelsFor ? { minHeight: swap.minHeight } : undefined}
            className={
              swap.animate
                ? "animate-[pego-fade-in_var(--duration-instant)_var(--ease-out)]"
                : undefined
            }
          >
            {modelsFor?.kind === "local" ? (
              <ModelsView
                agentId={modelsFor.id}
                onBack={() => showModels(null)}
                onDone={() => setOpen(false)}
              />
            ) : modelsFor?.kind === "custom" ? (
              <CustomModelsView
                providerId={modelsFor.id}
                onBack={() => showModels(null)}
                onDone={() => setOpen(false)}
              />
            ) : (
              <AgentMenu
                hasKey={hasKey}
                onClose={() => setOpen(false)}
                onModels={showModels}
                onSettings={openSettings}
              />
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
};
