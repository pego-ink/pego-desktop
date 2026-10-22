import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { desktopApi } from "@/desktop/desktop-api";
import { useUpdateStatus } from "@/desktop/use-update-status";
import { WEB_VERSION } from "./app-version";
import { describeUpdate } from "./update-view";

const RELEASES_URL = "https://github.com/yolkmonday/pego/releases";
const ISSUES_URL = "https://github.com/yolkmonday/pego/issues";

/** Pego mark (design/logo/pego-mark.svg) without its background tile. */
const PegoMark = () => (
  <svg aria-hidden viewBox="0 0 222.35 245.8" className="h-10 w-auto fill-current">
    <path
      fillRule="nonzero"
      d="M150.04999 0l-109.4 0c-22.19999 0-40.64999 18.35-40.64999 41.8l0 164.55001c0 22.79998 18.6 39.45001 39.39999 39.45001l118.60001 0c10.5 0 20.85001-3.60001 26.45001-10.05002 4.04999-4.54999 3-9.5-1.54999-12.39999l-16.30001-10.95002c-3.65001-2.29998-8.65001-1.85-11.2 0.85001l-23.90001 24.30002c-3.40001 3.59997-8.45 0.94998-8.45-4.15003l0-76.6c0-4.04999 3.5-6.15 6.84999-4.75l47.65 21.39999c0.85 0.35004 1.35 0.10001 2.04999-0.19998 21.15002-9.89999 42.75003-40.20001 42.75003-82.55001 0-54.39999-34.25-90.69999-72.30002-90.69999z m-29.94998 131.85001l-37.5 0c-9.35001 0-16.40001-7.15002-16.40001-16.50001l0-40.3c0-11.85001 8.65001-20.09999 20.25001-20.09999l40.04999-0.00001c17.8 0 32.39999 16.64999 32.39999 36.4 0 23.70001-20 40.50001-38.79998 40.50001z"
    />
  </svg>
);

const ExternalLink = ({ href, children }: { href: string; children: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 rounded-sm text-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
  >
    {children}
    <ExternalLinkIcon aria-hidden />
  </a>
);

const UpdatesSection = () => {
  const status = useUpdateStatus((s) => s.status);
  const api = desktopApi();
  if (!api) {
    return (
      <p className="text-xs text-muted-foreground">Updates are available in the desktop app.</p>
    );
  }
  const view = describeUpdate(status);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {view.action === "restart" ? (
          <Button size="sm" onClick={() => api.installUpdate()}>
            Restart to update
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={view.busy}
            onClick={() => void api.checkForUpdates()}
          >
            Check for updates
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" className="min-h-4">
        {view.text ? (
          <p
            className={
              view.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {view.text}
          </p>
        ) : null}
      </div>
      {view.percent !== undefined ? (
        <div
          role="progressbar"
          aria-label="Update download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          className="h-1 w-full max-w-64 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] duration-(--duration-fast) ease-out"
            style={{ width: `${view.percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

export const AboutTab = () => {
  const version = desktopApi()?.version ?? WEB_VERSION;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-xl bg-muted text-foreground">
          <PegoMark />
        </div>
        <div>
          <h3 className="text-base font-semibold">Pego</h3>
          <p className="text-xs text-muted-foreground">
            {version ? `Version ${version}` : "Version unknown"}
          </p>
        </div>
      </div>
      <section>
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">Updates</h3>
        <UpdatesSection />
      </section>
      <section>
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">Links</h3>
        <div className="flex flex-col items-start gap-2.5">
          <ExternalLink href={RELEASES_URL}>Release notes and downloads</ExternalLink>
          <ExternalLink href={ISSUES_URL}>Report an issue</ExternalLink>
        </div>
      </section>
    </div>
  );
};
