import { useState, type FormEvent } from "react";
import { LinkIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { Spinner } from "@pego/ui/components/spinner";
import { httpsUrl, placeImageFromUrl } from "./image-from-url";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Assets › Images › From URL: download an image from the web and place it. */
export const UrlImageSection = () => {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const url = httpsUrl(value);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url || busy) return;
    setBusy(true);
    const placed = await placeImageFromUrl(url);
    setBusy(false);
    if (placed) setValue("");
  };

  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <form onSubmit={(event) => void onSubmit(event)} className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <LinkIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={value}
            placeholder="https://… image link"
            aria-label="Image URL"
            onChange={(event) => setValue(event.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button type="submit" size="sm" className="h-7" disabled={!url || busy}>
          {busy ? <Spinner className="size-3" /> : null}
          Place
        </Button>
      </form>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Paste the link of an image on the web. Or copy an image on any site (right-click › Copy
        image, or its link) and press {isMac ? "⌘V" : "Ctrl+V"} on the canvas. The image is
        downloaded into your file; sites that block it are fetched through the Pego bridge.
      </p>
    </div>
  );
};
