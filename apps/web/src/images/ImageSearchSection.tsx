import { useEffect, useRef, useState, type FormEvent } from "react";
import { SearchIcon } from "lucide-react";
import type { StockImage } from "@pego/agent";
import { Input } from "@pego/ui/components/input";
import { Spinner } from "@pego/ui/components/spinner";
import { searchOpenverse } from "./openverse";
import { creditLine, placeStockImage, STOCK_IMAGE_MIME } from "./stock-image";

const RESULTS = 20;

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; images: StockImage[] }
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
      onClick={() => placeStockImage(image)}
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
        draggable={false}
        className="size-full object-cover transition-transform duration-(--duration-base) group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {image.creator ?? image.title} · {image.license}
      </span>
    </button>
  );
};

/**
 * Assets › Images: search openly licensed photos (Openverse), then click one to place it or drag
 * it onto the canvas. The credit and license stay on the layer (alt text and source link).
 */
export const ImageSearchSection = () => {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const latest = useRef(0);

  const search = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const run = ++latest.current;
    setState({ status: "loading", query: trimmed });
    try {
      const images = await searchOpenverse({ query: trimmed, count: RESULTS });
      if (run === latest.current) setState({ status: "done", query: trimmed, images });
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
            Find free photos for your design. Press Enter to search, then click a photo to place it
            or drag it onto the canvas.
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[11px] leading-4 text-destructive">
            {state.message}
          </p>
        ) : state.status === "done" && state.images.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No photo found for “{state.query}”. Try other words.
          </p>
        ) : state.status === "done" ? (
          <div className="grid grid-cols-2 gap-1.5" aria-label={`Photos for ${state.query}`}>
            {state.images.map((image) => (
              <ImageResult key={image.src} image={image} />
            ))}
          </div>
        ) : null}
      </div>
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
    </div>
  );
};
