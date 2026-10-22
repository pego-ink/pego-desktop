import { Icon, type IconifyIcon } from "@iconify/react";
import { cn } from "@pego/ui/lib/utils";
import type { ProviderId } from "@/panels/agent/agent-format";
import {
  CLAUDE_ICON,
  CURSOR_ICON,
  GEMINI_ICON,
  OPENAI_ICON,
  OPENCODE_ICON,
  QWEN_ICON,
} from "@/panels/agent/provider-icons";

/** The "anthropic" provider id shows the Claude starburst (Claude Code and the API-key backend). */
const ICONS: Record<ProviderId, IconifyIcon> = {
  anthropic: CLAUDE_ICON,
  openai: OPENAI_ICON,
  opencode: OPENCODE_ICON,
  qwen: QWEN_ICON,
  gemini: GEMINI_ICON,
  cursor: CURSOR_ICON,
};

/** 14px provider mark. Hidden from assistive tech; pair it with the agent's text label. */
export const ProviderLogo = ({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) => <Icon icon={ICONS[provider]} aria-hidden className={cn("size-3.5 shrink-0", className)} />;
