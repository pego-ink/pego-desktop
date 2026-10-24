import { ImageIcon, MinusIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import type { Fill, GradientStop, ImageFill, PegoNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { PropColor } from "@/panels/properties/PropColor";
import { RawNumberField } from "@/panels/properties/PropNumber";
import {
  addStop,
  convertFill,
  FILL_KINDS,
  kindOfFill,
  type FillKind,
} from "@/panels/properties/fill-kind";
import { imageFileToDataUri, pickImageFile } from "@/panels/properties/image-file";
import { DEFAULT_FILL, hasShapeFill, rawProp } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";
import { ShaderFillEditor } from "@/panels/properties/ShaderFillEditor";

type Phase = "commit" | "extend";

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick}>
    {children}
  </Button>
);

const IMAGE_FITS: readonly [ImageFill["fit"], string][] = [
  ["cover", "Cover"],
  ["contain", "Contain"],
  ["stretch", "Stretch"],
];

const chooseImage = async (): Promise<string | null> => {
  const file = await pickImageFile();
  if (!file) return null;
  try {
    return await imageFileToDataUri(file);
  } catch (error) {
    toast.error(`Could not read image: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

/** Fill of the node: a color for every painted node, plus gradients and images for shapes. */
export const FillSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const fill = rawProp(node, "fill") as Fill | undefined;
  const shapes = hasShapeFill(node);
  const setFill = (next: Fill, label: string, phase?: Phase) => apply({ fill: next }, label, phase);
  /** Edit the current (non-solid) fill read fresh from the node, so drags extend one undo step. */
  const editFill = (change: (fill: Exclude<Fill, string>) => Fill, label: string, phase?: Phase) =>
    apply(
      (n) => {
        const current = rawProp(n, "fill") as Fill | undefined;
        return typeof current === "object" ? { fill: change(current) } : {};
      },
      label,
      phase,
    );

  const changeKind = async (kind: FillKind) => {
    if (fill === undefined) return;
    if (kind === "image") {
      const src = await chooseImage();
      if (src) setFill({ type: "image", src, fit: "cover" }, "Set image fill");
      return;
    }
    const next = convertFill(fill, kind);
    if (next !== null) setFill(next, "Change fill type");
  };

  return (
    <PropertySection
      title="Fill"
      action={
        fill === undefined ? (
          <IconButton label="Add fill" onClick={() => setFill(DEFAULT_FILL, "Add fill")}>
            <PlusIcon />
          </IconButton>
        ) : (
          <IconButton label="Remove fill" onClick={() => apply({ fill: null }, "Remove fill")}>
            <MinusIcon />
          </IconButton>
        )
      }
    >
      {fill === undefined ? null : (
        <>
          {shapes ? (
            <NativeSelect
              aria-label="Fill type"
              value={kindOfFill(fill)}
              onChange={(event) => void changeKind(event.target.value as FillKind)}
            >
              {FILL_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {typeof fill === "string" ? (
            <PropColor
              raw={fill}
              label="Fill color"
              onChange={(value, phase) => setFill(value, "Change fill", phase)}
            />
          ) : fill.type === "shader" ? (
            <ShaderFillEditor
              fill={fill}
              onChange={(change, label, phase) =>
                editFill((f) => (f.type === "shader" ? change(f) : f), label, phase)
              }
            />
          ) : fill.type === "image" ? (
            <PropertyRow className="grid-cols-[1fr_auto]">
              <NativeSelect
                aria-label="Image fit"
                value={fill.fit}
                onChange={(event) =>
                  editFill(
                    (f) => ({ ...f, fit: event.target.value as ImageFill["fit"] }),
                    "Change image fit",
                  )
                }
              >
                {IMAGE_FITS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <IconButton
                label="Replace image"
                onClick={() =>
                  void chooseImage().then((src) => {
                    if (src) editFill((f) => ({ ...f, src }) as Fill, "Replace image");
                  })
                }
              >
                <ImageIcon />
              </IconButton>
            </PropertyRow>
          ) : (
            <>
              {fill.type === "linear" ? (
                <RawNumberField
                  raw={fill.angle}
                  fallback={180}
                  label={<RotateCwIcon />}
                  labelTitle="Gradient angle (0 = up, 90 = right)"
                  suffix="°"
                  onChange={(angle, phase) =>
                    editFill((f) => ({ ...f, angle }) as Fill, "Change gradient angle", phase)
                  }
                />
              ) : null}
              <GradientStops
                stops={fill.stops}
                onChange={(change, label, phase) =>
                  editFill(
                    (f) =>
                      ({ ...f, stops: change((f as { stops: GradientStop[] }).stops) }) as Fill,
                    label,
                    phase,
                  )
                }
              />
            </>
          )}
        </>
      )}
    </PropertySection>
  );
};

const GradientStops = ({
  stops,
  onChange,
}: {
  stops: readonly GradientStop[];
  onChange: (
    change: (stops: GradientStop[]) => GradientStop[],
    label: string,
    phase?: Phase,
  ) => void;
}) => {
  const setStop = (index: number, patch: Partial<GradientStop>, label: string, phase?: Phase) =>
    onChange(
      (current) => current.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)),
      label,
      phase,
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-5 items-center justify-between">
        <span className="font-mono text-[10px] tracking-wider text-subtle-foreground uppercase">
          Stops
        </span>
        <IconButton label="Add stop" onClick={() => onChange(addStop, "Add gradient stop")}>
          <PlusIcon />
        </IconButton>
      </div>
      {stops.map((stop, index) => (
        <PropertyRow key={index} className="grid-cols-[1fr_4.5rem_auto]">
          <PropColor
            raw={stop.color}
            label={`Stop ${index + 1} color`}
            onChange={(color, phase) => setStop(index, { color }, "Change gradient", phase)}
          />
          <RawNumberField
            raw={Math.round(stop.position * 100)}
            min={0}
            max={100}
            suffix="%"
            label="P"
            labelTitle="Stop position"
            onChange={(percent, phase) =>
              setStop(index, { position: percent / 100 }, "Change gradient", phase)
            }
          />
          <IconButton
            label="Remove stop"
            onClick={() => {
              // A gradient needs two stops.
              if (stops.length > 2) {
                onChange(
                  (current) => current.filter((_, i) => i !== index),
                  "Remove gradient stop",
                );
              }
            }}
          >
            <MinusIcon />
          </IconButton>
        </PropertyRow>
      ))}
    </div>
  );
};
