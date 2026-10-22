import { cn } from "@pego/ui/lib/utils";
import { showDashboard, useWorkspaceStore } from "./use-workspace-store";

/** The Pego mark (design/logo/pego-mark.svg) in the current text color. */
const PegoMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 222.35 245.8" aria-hidden className={className} fill="currentColor">
    <path d="M150.04999 0l-109.4 0c-22.19999 0-40.64999 18.35-40.64999 41.8l0 164.55001c0 22.79998 18.6 39.45001 39.39999 39.45001l118.60001 0c10.5 0 20.85001-3.60001 26.45001-10.05002 4.04999-4.54999 3-9.5-1.54999-12.39999l-16.30001-10.95002c-3.65001-2.29998-8.65001-1.85-11.2 0.85001l-23.90001 24.30002c-3.40001 3.59997-8.45 0.94998-8.45-4.15003l0-76.6c0-4.04999 3.5-6.15 6.84999-4.75l47.65 21.39999c0.85 0.35004 1.35 0.10001 2.04999-0.19998 21.15002-9.89999 42.75003-40.20001 42.75003-82.55001 0-54.39999-34.25-90.69999-72.30002-90.69999z m-29.94998 131.85001l-37.5 0c-9.35001 0-16.40001-7.15002-16.40001-16.50001l0-40.3c0-11.85001 8.65001-20.09999 20.25001-20.09999l40.04999-0.00001c17.8 0 32.39999 16.64999 32.39999 36.4 0 23.70001-20 40.50001-38.79998 40.50001z" />
  </svg>
);

/** The logo is the way home: it opens the dashboard. */
export const HomeButton = () => {
  const onDashboard = useWorkspaceStore((s) => s.view === "dashboard");
  return (
    <button
      type="button"
      aria-label="Pego home (dashboard)"
      aria-current={onDashboard ? "page" : undefined}
      title="Dashboard"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
        onDashboard && "bg-accent",
      )}
      onClick={() => showDashboard()}
    >
      <PegoMark className="h-4 w-auto" />
      Pego
    </button>
  );
};
