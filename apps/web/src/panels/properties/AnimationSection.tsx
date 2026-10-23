import { toast } from "sonner";
import { ListOrderedIcon, MinusIcon, PlayIcon, PlusIcon, SquareIcon } from "lucide-react";
import type { Animation, AnimationEasing, AnimationPreset, PegoNode } from "@pego/doc";
import { DEFAULT_ANIMATION_DURATION, easingOf } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { NumberField } from "@pego/ui/components/number-field";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { useApplyProps } from "@/panels/properties/use-apply-props";
import { useDocumentStore } from "@/store/use-document-store";
import { useMotionStore } from "@/motion/use-motion-store";
import { staggerChildrenOps } from "@/motion/stagger";

const PRESETS: readonly (readonly [AnimationPreset, string])[] = [
  ["fade", "Fade in"],
  ["slide_up", "Slide up"],
  ["slide_down", "Slide down"],
  ["slide_left", "Slide left"],
  ["slide_right", "Slide right"],
  ["grow_up", "Grow up (bar)"],
  ["grow_right", "Grow right (bar)"],
  ["scale", "Scale in"],
  ["pop", "Pop"],
  ["none", "No motion"],
];

const EASINGS: readonly (readonly [AnimationEasing, string])[] = [
  ["ease_out", "Ease out"],
  ["ease_in_out", "Ease in-out"],
  ["linear", "Linear"],
  ["spring", "Spring"],
];

const Caption = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">
    {text}
    {children}
  </label>
);

/** Play every animation on the page, or stop the preview that runs. */
export const PlayMotionButton = () => {
  const playing = useMotionStore((s) => s.startedAt !== null);
  return (
    <Button
      variant="secondary"
      size="sm"
      className="flex-1"
      onClick={() => {
        const motion = useMotionStore.getState();
        if (playing) return motion.stop();
        if (!motion.play())
          toast("Nothing to play yet", { description: "Add an animation first." });
      }}
    >
      {playing ? <SquareIcon /> : <PlayIcon />}
      {playing ? "Stop" : "Play"}
    </Button>
  );
};

/** The node's entrance: preset, timing, count-up for text, plus Play and "children one by one". */
export const AnimationSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  if (node.type === "page") return null;
  const animation = node.animation;
  const set = (patch: Partial<Animation>, label: string, phase: "commit" | "extend" = "commit") =>
    apply(
      (n) => ({ animation: { ...(n.type === "page" ? undefined : n.animation), ...patch } }),
      label,
      phase,
    );
  const visibleChildren =
    "children" in node ? node.children.filter((child) => child.visible !== false) : [];
  const staggerChildren = () => {
    const animated = visibleChildren.find((c) => c.type !== "page" && c.animation);
    const preset = animated && animated.type !== "page" ? animated.animation?.preset : undefined;
    const ops = staggerChildrenOps(node, preset ?? "slide_up", animation?.delay ?? 0);
    useDocumentStore.getState().commit(ops, { label: "Animate children one by one" });
    useMotionStore.getState().play();
  };

  return (
    <PropertySection
      title="Animation"
      action={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={animation ? "Remove animation" : "Add animation"}
          title={animation ? "Remove animation" : "Add animation"}
          onClick={() =>
            animation
              ? apply({ animation: null }, "Remove animation")
              : apply(
                  {
                    animation:
                      node.type === "text" && /\d/.test(node.content)
                        ? { preset: "fade", countUp: true }
                        : { preset: "slide_up" },
                  },
                  "Add animation",
                )
          }
        >
          {animation ? <MinusIcon /> : <PlusIcon />}
        </Button>
      }
    >
      {animation ? (
        <>
          <PropertyRow>
            <Caption text="Effect">
              <NativeSelect
                aria-label="Animation effect"
                value={animation.preset}
                onChange={(event) =>
                  set({ preset: event.target.value as AnimationPreset }, "Change animation")
                }
              >
                {PRESETS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Caption>
            <Caption text="Easing">
              <NativeSelect
                aria-label="Animation easing"
                value={easingOf(animation)}
                onChange={(event) =>
                  set({ easing: event.target.value as AnimationEasing }, "Change easing")
                }
              >
                {EASINGS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Caption>
          </PropertyRow>
          <PropertyRow>
            <NumberField
              label="D"
              labelTitle="Delay (ms after Play)"
              value={animation.delay ?? 0}
              min={0}
              max={60_000}
              step={50}
              suffix=" ms"
              onChange={(delay, phase) => set({ delay }, "Change delay", phase)}
            />
            <NumberField
              label="T"
              labelTitle="Duration (ms)"
              value={animation.duration ?? DEFAULT_ANIMATION_DURATION}
              min={1}
              max={60_000}
              step={50}
              suffix=" ms"
              onChange={(duration, phase) => set({ duration }, "Change duration", phase)}
            />
          </PropertyRow>
          {node.type === "text" ? (
            <label className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={animation.countUp === true}
                onChange={(event) =>
                  set({ countUp: event.target.checked || undefined }, "Toggle count up")
                }
              />
              Count numbers up (e.g. 0 → 70%)
            </label>
          ) : null}
        </>
      ) : null}
      <div className="flex gap-1.5">
        <PlayMotionButton />
        {visibleChildren.length > 1 ? (
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            title="Give the children the same entrance, one after another"
            onClick={staggerChildren}
          >
            <ListOrderedIcon />
            One by one
          </Button>
        ) : null}
      </div>
    </PropertySection>
  );
};
