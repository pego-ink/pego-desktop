import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon } from "lucide-react";
import type { StockImage } from "@pego/agent";
import { Input } from "@pego/ui/components/input";
import { Spinner } from "@pego/ui/components/spinner";
import { useSettingsStore } from "@/store/use-settings-store";
import { browserApi, revealBrowserPanel } from "@/browser/browser-session";
import { Button } from "@pego/ui/components/button";
import { searchPhotos } from "./image-search";
import { creditLine, placeFoundImage, STOCK_IMAGE_MIME } from "./stock-image";

const RESULTS = 20;

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; images: StockImage[]; note?: string }
  | { status: "error"; query: string; message: string };

/** One result: click places it in the middle of the view, drag drops it where it lands. */
const ImageResult = ({ image }: { image: StockImage }) => {
  const credit = creditLine(image);
  return (
    <button
      type="button"
      draggable
      title={`${credit}\nClick to place, or drag onto the canvas.`}
      aria-label={`Place ${image.title}`}
      onClick={() => void placeFoundImage(image)}
      onDragStart={(event) => {
        event.dataTransfer.setData(STOCK_IMAGE_MIME, JSON.stringify(image));
        event.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative aspect-square overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <img
        src={image.thumb}
        alt={image.title}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        className="size-full object-cover transition-transform duration-(--duration-base) group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {image.creator ?? image.title} · {image.license}
      </span>
    </button>
  );
};

/** Why the results are not from Google, with a way to the Browser panel when Google asks for a check. */
const SearchNote = ({ note }: { note: string }) => (
  <div
    role="status"
    className="mb-2 flex flex-col items-start gap-1 text-[11px] leading-4 text-muted-foreground"
  >
    <p>{note}</p>
    {/Browser panel/.test(note) ? (
      <Button variant="secondary" size="xs" onClick={revealBrowserPanel}>
        Open the Browser panel
      </Button>
    ) : null}
  </div>
);

/**
 * Assets › Images: search photos (Google Images in the built-in browser, or Openverse's openly
 * licensed ones, per Settings), then click one to place it or drag it onto the canvas. The credit
 * and source stay on the layer (alt text and source link).
 */
export const ImageSearchSection = () => {
  const webSearch =
    useSettingsStore((s) => s.imageSearch === "browser") && browserApi() !== undefined;
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const latest = useRef(0);

  const search = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const run = ++latest.current;
    setState({ status: "loading", query: trimmed });
    try {
      const { images, note } = await searchPhotos(
        { query: trimmed, count: RESULTS },
        { reveal: false },
      );
      if (run === latest.current) setState({ status: "done", query: trimmed, images, note });
    } catch (error) {
      if (run === latest.current)
        setState({
          status: "error",
          query: trimmed,
          message: error instanceof Error ? error.message : "The search failed.",
        });
    }
  };

  // A search in flight is dropped when the panel closes.
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void search(query);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={onSubmit} className="flex items-center gap-1.5 px-3 pb-2">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            placeholder="Search photos, e.g. fried chicken"
            aria-label="Search photos"
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {state.status === "loading" ? <Spinner className="size-3.5" /> : null}
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {state.status === "idle" ? (
          <p className="text-[11px] leading-4 text-muted-foreground">
            {webSearch
              ? "Find pictures on Google for your design. Press Enter to search, then click one to place it or drag it onto the canvas."
              : "Find free photos for your design. Press Enter to search, then click a photo to place it or drag it onto the canvas."}
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[11px] leading-4 text-destructive">
            {state.message}
          </p>
        ) : state.status === "done" ? (
          <>
            {state.note ? <SearchNote note={state.note} /> : null}
            {state.images.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No photo found for “{state.query}”. Try other words.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5" aria-label={`Photos for ${state.query}`}>
                {state.images.map((image) => (
                  <ImageResult key={image.src} image={image} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
      {webSearch ? (
        <p className="border-t border-border px-3 py-2 text-[10px] leading-3.5 text-muted-foreground">
          Pictures from Google Images, found with Pego&apos;s built-in browser. Web pictures are
          usually copyrighted: each placed one keeps its source on the layer and is saved in your
          file. Switch to free photos in Settings › General › Image search.
        </p>
      ) : (
        <p className="border-t border-border px-3 py-2 text-[10px] leading-3.5 text-muted-foreground">
          Openly licensed photos from{" "}
          <a
            href="https://openverse.org"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Openverse
          </a>
          . Each placed photo keeps its credit and license on the layer. Photos are linked, not
          embedded, so they need a connection to show.
        </p>
      )}
    </div>
  );
};
