import type { SVGProps } from "react";
import { cn } from "@pego/ui/lib/utils";
import type { ProviderId } from "@/panels/agent/agent-format";

type MarkProps = SVGProps<SVGSVGElement>;

/* Simple marks drawn on a 24px grid. Decorative: the agent label next to them names the provider. */

const Anthropic = (props: MarkProps) => (
  <svg viewBox="0 0 24 24" fill="#d97757" {...props}>
    <path d="M13.83 3.52h3.6L24 20h-3.6l-6.57-16.48ZM6.57 3.52h3.77L16.9 20h-3.67l-1.34-3.46H5.02L3.67 20H0L6.57 3.52Zm4.13 9.96L8.45 7.69 6.2 13.48h4.5Z" />
  </svg>
);

const OpenAI = (props: MarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinejoin="round"
    {...props}
  >
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(0 12 12)" />
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(60 12 12)" />
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(120 12 12)" />
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(180 12 12)" />
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(240 12 12)" />
    <rect x="9" y="1.5" width="6" height="14" rx="3" transform="rotate(300 12 12)" />
  </svg>
);

const Opencode = (props: MarkProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M4 2h16v20H4V2Zm4 6v8h8V8H8Z" />
    <path d="M8 12h8v4H8z" opacity={0.45} />
  </svg>
);

const Qwen = (props: MarkProps) => (
  <svg viewBox="0 0 24 24" fill="#7f6cf6" {...props}>
    <path d="M12 1.5 21 6.75v10.5L12 22.5 3 17.25V6.75L12 1.5Z" opacity={0.28} />
    <path d="M12 1.5 21 6.75 16.2 9.6 12 7.1 7.8 9.6 3 6.75 12 1.5Z" />
    <path
      d="M3 6.75 7.8 9.6v4.8L3 17.25V6.75Zm18 0v10.5l-4.8-2.85V9.6L21 6.75ZM12 16.9l4.2-2.5L21 17.25l-9 5.25-9-5.25 4.8-2.85 4.2 2.5Z"
      opacity={0.75}
    />
  </svg>
);

const Gemini = (props: MarkProps) => (
  <svg viewBox="0 0 24 24" fill="#5b9bf5" {...props}>
    <path d="M12 1.5Q12.9 11.1 22.5 12 12.9 12.9 12 22.5 11.1 12.9 1.5 12 11.1 11.1 12 1.5Z" />
  </svg>
);

const Cursor = (props: MarkProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 1.5 21 6.75 12 12 3 6.75 12 1.5Z" opacity={0.6} />
    <path d="M3 6.75 12 12v10.5L3 17.25V6.75Z" opacity={0.85} />
    <path d="M21 6.75v10.5L12 22.5V12l9-5.25Z" />
  </svg>
);

const MARKS: Record<ProviderId, (props: MarkProps) => React.JSX.Element> = {
  anthropic: Anthropic,
  openai: OpenAI,
  opencode: Opencode,
  qwen: Qwen,
  gemini: Gemini,
  cursor: Cursor,
};

/** 16px provider mark. Hidden from assistive tech; pair it with the agent's text label. */
export const ProviderLogo = ({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) => {
  const Mark = MARKS[provider];
  return <Mark aria-hidden focusable={false} className={cn("size-4 shrink-0", className)} />;
};
