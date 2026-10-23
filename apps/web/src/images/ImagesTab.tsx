import { useState } from "react";
import { cn } from "@pego/ui/lib/utils";
import { GenerateImageSection } from "./GenerateImageSection";
import { ImageSearchSection } from "./ImageSearchSection";

type Mode = "search" | "generate";

const MODES: readonly { id: Mode; label: string }[] = [
  { id: "search", label: "Search photos" },
  { id: "generate", label: "Generate" },
];

/** Assets › Images: find a free photo, or generate an image with the user's image model. */
export const ImagesTab = () => {
  const [mode, setMode] = useState<Mode>("search");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="radiogroup"
        aria-label="Images"
        className="mx-3 mb-2 flex rounded-md bg-muted p-0.5"
      >
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              "h-6 flex-1 rounded-sm text-xs text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === id && "bg-secondary text-foreground shadow-xs",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "search" ? <ImageSearchSection /> : <GenerateImageSection />}
    </div>
  );
};
