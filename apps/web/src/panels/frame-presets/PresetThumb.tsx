const BOX = 16;

/** Tiny rectangle with the preset's proportions, fitted into a 16px square. */
export const PresetThumb = ({ width, height }: { width: number; height: number }) => {
  const scale = BOX / Math.max(width, height);
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
      <span
        className="rounded-[1px] border border-muted-foreground/70 bg-muted"
        style={{
          width: Math.max(3, Math.round(width * scale)),
          height: Math.max(3, Math.round(height * scale)),
        }}
      />
    </span>
  );
};
