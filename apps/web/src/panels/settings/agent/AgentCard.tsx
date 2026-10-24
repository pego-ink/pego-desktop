import type { ReactNode } from "react";
import { Button } from "@pego/ui/components/button";
import { ProviderLogo } from "@/panels/agent/ProviderLogo";

/** Marks the agent the composer uses, or offers to switch to it. */
export const UseButton = ({
  active,
  disabled,
  onUse,
}: {
  active: boolean;
  disabled: boolean;
  onUse: () => void;
}) =>
  active ? (
    <span className="rounded-full bg-violet-soft px-2 py-0.5 text-[11px] font-medium text-violet-text">
      Active
    </span>
  ) : (
    <Button size="xs" variant="secondary" disabled={disabled} onClick={onUse}>
      Use
    </Button>
  );

type AgentCardProps = {
  provider: Parameters<typeof ProviderLogo>[0]["provider"];
  title: string;
  titleId: string;
  badge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
};

/** Compact bordered card for one provider or agent. */
export const AgentCard = ({
  provider,
  title,
  titleId,
  badge,
  action,
  children,
}: AgentCardProps) => (
  <section aria-labelledby={titleId} className="grid gap-2 rounded-xl border border-border p-3">
    <div className="flex items-center gap-2">
      <ProviderLogo provider={provider} />
      <h4 id={titleId} className="min-w-0 truncate text-[13px] font-semibold">
        {title}
      </h4>
      {badge}
      <span className="ml-auto flex shrink-0 items-center gap-2">{action}</span>
    </div>
    {children}
  </section>
);
