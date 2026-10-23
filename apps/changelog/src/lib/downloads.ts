import { getEntries } from "@/lib/entries";
import { getReleases } from "@/lib/releases";
import {
  groupReleaseAssets,
  pickDownloadTargets,
  type DownloadTargets,
  type Release,
} from "@/lib/release-assets";

let cached: Promise<DownloadTargets> | undefined;

/** Which entry shows which release's download block, and the release the header button points at. */
export const getDownloads = () =>
  (cached ??= (async () =>
    pickDownloadTargets(
      (await getEntries()).map((e) => ({ id: e.id, version: e.data.version })),
      await getReleases(),
    ))());

/** In-page anchor of a version's download block. */
export const downloadAnchor = (version: string) => `download-${version}`;

/** schema.org SoftwareApplication for a release, listing the platforms it ships for. */
export const softwareJsonLd = (release: Release) => {
  const d = groupReleaseAssets(release.assets);
  const systems = [
    d.macos.length > 0 && "macOS",
    d.windows.length > 0 && "Windows",
    d.linux.length > 0 && "Linux",
  ].filter(Boolean);
  const first = d.macos[0] ?? d.windows[0] ?? d.linux[0];
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Pego",
    applicationCategory: "DesignApplication",
    operatingSystem: systems.join(", "),
    softwareVersion: release.version,
    downloadUrl: first?.url ?? release.url,
    url: "https://pego.ink",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
};
