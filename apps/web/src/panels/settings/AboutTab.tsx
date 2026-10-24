import { useEffect } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { desktopApi, type UpdateChannel } from "@/desktop/desktop-api";
import { useUpdateChannel } from "@/desktop/use-update-channel";
import { useUpdateStatus } from "@/desktop/use-update-status";
import { SettingRow } from "./SettingRow";
import { WEB_VERSION } from "./app-version";
import { channelLockHint, describeUpdate } from "./update-view";
import { PegoMark } from "@/components/PegoMark";

const RELEASES_URL = "https://github.com/pego-ink/pego-desktop/releases";
const ISSUES_URL = "https://github.com/pego-ink/pego-desktop/issues";

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

const CHANNEL_OPTIONS = [
  { value: "stable", label: "Stable", title: "Released versions, tested before they ship" },
  {
    value: "nightly",
    label: "Nightly",
    title: "Built every night from the latest development work",
  },
] as const satisfies readonly { value: UpdateChannel; label: string; title: string }[];

/** Stable / Nightly switch; hidden while loading and for installs that cannot update themselves. */
const ChannelRow = () => {
  const channel = useUpdateChannel((s) => s.channel);
  const error = useUpdateChannel((s) => s.error);
  const load = useUpdateChannel((s) => s.load);
  const select = useUpdateChannel((s) => s.select);
  const status = useUpdateStatus((s) => s.status);
  const lock = channelLockHint(status, desktopApi()?.platform ?? "");
  useEffect(() => {
    void load();
  }, [load]);
  if (!channel) return null;
  return (
    <div>
      <SettingRow
        title="Update channel"
        description={
          lock ?? "Nightly: built every night from the latest development work; may be unstable."
        }
      >
        {() => (
          <SegmentedControl
            aria-label="Update channel"
            value={channel}
            options={CHANNEL_OPTIONS}
            disabled={lock !== null}
            onChange={(next) => void select(next)}
            className="w-56"
          />
        )}
      </SettingRow>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          Could not switch the update channel. {error}
        </p>
      ) : null}
    </div>
  );
};

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
      <ChannelRow />
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
          <PegoMark className="size-10" />
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
