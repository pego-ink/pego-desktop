import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

type CopyFieldProps = {
  value: string;
  className?: string;
};

/** Read-only monospace snippet with a copy button. */
function CopyField({ value, className }: CopyFieldProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div
      data-slot="copy-field"
      className={cn("flex items-start gap-1 rounded-md bg-muted py-1 pr-1 pl-2", className)}
    >
      <code className="min-w-0 flex-1 py-0.5 font-mono text-[11px] leading-4 break-all text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy"}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {copied ? (
            <path d="M20 6 9 17l-5-5" />
          ) : (
            <>
              <rect width="14" height="14" x="8" y="8" rx="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export { CopyField };
