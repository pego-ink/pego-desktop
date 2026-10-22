import {
  CircleIcon,
  FrameIcon,
  HandIcon,
  MousePointer2Icon,
  SquareIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { useToolStore, type Tool } from "@/store/use-tool-store";

const TOOLS: readonly { tool: Tool; label: string; shortcut: string; Icon: LucideIcon }[] = [
  { tool: "select", label: "Move", shortcut: "V", Icon: MousePointer2Icon },
  { tool: "hand", label: "Hand", shortcut: "H", Icon: HandIcon },
  { tool: "frame", label: "Frame", shortcut: "F", Icon: FrameIcon },
  { tool: "rectangle", label: "Rectangle", shortcut: "R", Icon: SquareIcon },
  { tool: "ellipse", label: "Ellipse", shortcut: "O", Icon: CircleIcon },
  { tool: "text", label: "Text", shortcut: "T", Icon: TypeIcon },
];

/** Floating tool picker, bottom center of the canvas. */
export const Toolbar = () => {
  const active = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_24px_#00000055]"
    >
      {TOOLS.map(({ tool, label, shortcut, Icon }) => (
        <button
          key={tool}
          type="button"
          title={`${label} (${shortcut})`}
          aria-label={label}
          aria-pressed={active === tool}
          onClick={() => setTool(tool)}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active === tool
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="size-[18px]" />
        </button>
      ))}
    </div>
  );
};
