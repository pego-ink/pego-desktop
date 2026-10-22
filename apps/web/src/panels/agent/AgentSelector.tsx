import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react";
import { LOCAL_AGENT_IDS, type LocalAgentId } from "@pego/agent";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { findAgentInfo, LOCAL_AGENT_NAMES, requestModels } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { ModelList } from "@/panels/agent/ModelList";
import { ModelSettingsDialog, type SettingsSection } from "@/panels/agent/ModelSettingsDialog";
import { ProviderLogo } from "@/panels/agent/ProviderLogo";
import { StatusDot } from "@/panels/agent/StatusDot";
import { navigateList } from "@/panels/agent/list-nav";
import { useHasApiKey } from "@/panels/agent/use-has-api-key";
import {
  agentDetail,
  agentStatus,
  AGENT_PROVIDER,
  API_BACKEND_LABEL,
  isRunActive,
  MODEL_DEFAULT_LABEL,
  type AgentStatusTone,
} from "@/panels/agent/agent-format";

const rowClass =
  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";

type MenuRowProps = {
  role: "menuitemradio" | "menuitem";
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: ReactNode;
  badge?: string;
  detail?: string | null;
  detailTone?: AgentStatusTone;
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
  detail,
  detailTone,
  trailing,
}: MenuRowProps) => (
  <button
    data-nav
    type="button"
    role={role}
    aria-checked={role === "menuitemradio" ? checked === true : undefined}
    disabled={disabled}
    onClick={onClick}
    className={cn(rowClass, checked && "bg-accent/60")}
  >
    <span className="mt-0.5 flex shrink-0">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span className="truncate">{title}</span>
        {badge ? <span className="shrink-0 text-[11px] text-muted-foreground">{badge}</span> : null}
      </span>
      {detail ? (
        <span
          className={cn(
            "block text-[11px] leading-4 break-words",
            detailTone === "warn" ? "text-amber-400" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      ) : null}
    </span>
    {trailing}
  </button>
);

const Separator = () => <div role="separator" className="my-1 h-px bg-border" />;

type AgentMenuProps = {
  hasKey: boolean;
  onClose: () => void;
  onModels: (id: LocalAgentId) => void;
  onSettings: (section: SettingsSection) => void;
};

const AgentMenu = ({ hasKey, onClose, onModels, onSettings }: AgentMenuProps) => {
  const agents = useAgentStore((s) => s.bridge.agents);
  const connected = useAgentStore((s) => s.bridge.connected);
  const backend = useAgentStore((s) => s.backend);
  const activeId = useAgentStore((s) => s.localAgentId);
  const modelByAgent = useAgentStore((s) => s.modelByAgent);
  const setBackend = useAgentStore((s) => s.setBackend);
  const setLocalAgent = useAgentStore((s) => s.setLocalAgent);
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
      onModels(id);
      return;
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Agent"
      onKeyDown={navigateList}
      className="grid gap-0.5"
    >
      <MenuRow
        role="menuitemradio"
        checked={backend === "api"}
        onClick={pickApi}
        icon={<ProviderLogo provider="anthropic" />}
        title={API_BACKEND_LABEL}
        detail={
          hasKey ? "Runs in this browser with your key" : "No key yet. Add one in Model settings"
        }
        detailTone={hasKey ? "ready" : "warn"}
        trailing={
          backend === "api" ? <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null
        }
      />
      <Separator />
      {LOCAL_AGENT_IDS.map((id) => {
        const info = findAgentInfo(agents, id);
        const status = agentStatus(info, connected);
        const active = backend === "local" && id === activeId;
        const hasModels = connected && info?.installed === true && info.supportsModels;
        const model = modelByAgent[id];
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
            detail={agentDetail(id, info, connected)}
            detailTone={status.tone}
            trailing={
              <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                {active && hasModels ? (
                  <span className="max-w-20 truncate">{model ?? MODEL_DEFAULT_LABEL}</span>
                ) : null}
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
          icon={<StatusDot tone="off" className="my-1.5" />}
          title="Bridge not running"
          badge="Set up"
        />
      )}
      <Separator />
      <MenuRow
        role="menuitem"
        onClick={() => onSettings("add-provider")}
        icon={<PlusIcon aria-hidden className="size-4 text-muted-foreground" />}
        title="Add provider…"
      />
      <MenuRow
        role="menuitem"
        onClick={() => onSettings("top")}
        icon={<Settings2Icon aria-hidden className="size-4 text-muted-foreground" />}
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
    <div className="grid gap-1">
      <button
        type="button"
        aria-label="Back to agents"
        onClick={onBack}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <ChevronLeftIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <ProviderLogo provider={AGENT_PROVIDER[agentId]} />
        <span className="min-w-0 flex-1 truncate">{info?.name ?? LOCAL_AGENT_NAMES[agentId]}</span>
        <span className="text-[11px] text-muted-foreground">Model</span>
      </button>
      <div role="separator" className="h-px bg-border" />
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

type AgentSelectorProps = {
  /** Where focus goes after the popover or Model settings closes (the prompt box). */
  restoreFocusRef: RefObject<HTMLElement | null>;
};

/** Composer pill: current agent + model, with a popover to switch and a Model settings modal. */
export const AgentSelector = ({ restoreFocusRef }: AgentSelectorProps) => {
  const backend = useAgentStore((s) => s.backend);
  const localAgentId = useAgentStore((s) => s.localAgentId);
  const info = useAgentStore((s) => findAgentInfo(s.bridge.agents, s.localAgentId));
  const connected = useAgentStore((s) => s.bridge.connected);
  const model = useAgentStore((s) => s.modelByAgent[s.localAgentId]);
  const locked = useAgentStore((s) => isRunActive(s.status));
  const [hasKey, setHasKey] = useHasApiKey();
  const [open, setOpen] = useState(false);
  const [modelsFor, setModelsFor] = useState<LocalAgentId | null>(null);
  const [section, setSection] = useState<SettingsSection | null>(null);
  const opensSettings = useRef(false);

  const status = agentStatus(info, connected);
  const isApi = backend === "api";
  const name = isApi ? "API key" : (info?.name ?? LOCAL_AGENT_NAMES[localAgentId]);
  const modelLabel = !isApi && info?.supportsModels && model ? model : null;
  const tone: AgentStatusTone = isApi ? (hasKey ? "ready" : "warn") : status.tone;
  const stateLabel = isApi ? (hasKey ? "" : "no key") : tone === "ready" ? "" : status.label;
  const accessibleName = [
    `Agent: ${name}`,
    modelLabel ? `model ${modelLabel}` : null,
    stateLabel || null,
  ]
    .filter(Boolean)
    .join(", ");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setModelsFor(null);
  };

  const openSettings = (target: SettingsSection) => {
    opensSettings.current = true;
    setOpen(false);
    setSection(target);
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
          title={locked ? "Agent can't change while a run is active" : "Choose agent and model"}
          className="flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <ProviderLogo provider={isApi ? "anthropic" : AGENT_PROVIDER[localAgentId]} />
          <span className="min-w-0 truncate">
            <span className="text-foreground">{name}</span>
            {modelLabel ? <span> · {modelLabel}</span> : null}
          </span>
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
            setModelsFor(null);
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
            setModelsFor(null);
          }}
          className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto"
        >
          {modelsFor ? (
            <ModelsView
              agentId={modelsFor}
              onBack={() => setModelsFor(null)}
              onDone={() => setOpen(false)}
            />
          ) : (
            <AgentMenu
              hasKey={hasKey}
              onClose={() => setOpen(false)}
              onModels={setModelsFor}
              onSettings={openSettings}
            />
          )}
        </PopoverContent>
      </Popover>
      <ModelSettingsDialog
        section={section}
        onClose={() => setSection(null)}
        hasKey={hasKey}
        onHasKeyChange={setHasKey}
        onCloseAutoFocus={restoreFocus}
      />
    </>
  );
};
