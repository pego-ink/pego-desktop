import { useState } from "react";
import { cn } from "@pego/ui/lib/utils";
import { GenerateImageSection } from "./GenerateImageSection";
import { ImageSearchSection } from "./ImageSearchSection";
import { UrlImageSection } from "./UrlImageSection";

type Mode = "search" | "generate" | "url";

const MODES: readonly { id: Mode; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "generate", label: "Generate" },
  { id: "url", label: "From URL" },
];

/** Assets › Images: find a free photo, generate an image, or bring one in from a link. */
export const ImagesTab = () => {
  const [mode, setMode] = useState<Mode>("search");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="radiogroup"
        aria-label="Images"
        className="mx-3 mb-2 flex rounded-lg bg-muted p-0.5"
      >
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              "h-7 flex-1 rounded-md text-[13px] text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === id && "bg-violet-soft font-medium text-violet-text hover:text-violet-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "search" ? (
        <ImageSearchSection />
      ) : mode === "generate" ? (
        <GenerateImageSection />
      ) : (
        <UrlImageSection />
      )}
    </div>
  );
};
