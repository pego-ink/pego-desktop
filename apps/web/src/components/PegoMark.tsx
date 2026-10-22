import { cn } from "@pego/ui/lib/utils";

/**
 * Pego mark (design/logo/pego-mark.svg): the geometric pigeon on its dark tile. Brand colors are
 * fixed on purpose so the mark reads the same in light and dark themes.
 */
export const PegoMark = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 64 64" className={cn("size-6 shrink-0", className)}>
    <rect width="64" height="64" rx="16" fill="#0b1f17" />
    <path d="M16 24 L6 24 L16 36 Z" fill="#ffffff" />
    <path d="M16 24 L48 24 A32 32 0 0 1 16 56 Z" fill="#ffffff" />
    <path d="M16 24 L35 24 A19 19 0 0 1 16 43 Z" fill="#7fe0b8" />
    <circle cx="43" cy="17" r="9" fill="#ffffff" />
    <path d="M51 14 L58 17.5 L51 21 Z" fill="#7fe0b8" />
    <circle cx="44" cy="15" r="2" fill="#0b1f17" />
  </svg>
);
