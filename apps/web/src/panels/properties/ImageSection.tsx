import { useMemo } from "react";
import type { ImageNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { getImageNaturalSize } from "@/canvas/render-image-node";
import { pickImageFile, readImageFile } from "@/interaction/image-file";
import { useToolPreview } from "@/interaction/tool-handlers";
import { PropNumber } from "@/panels/properties/PropNumber";
import { TextCommitField } from "@/panels/properties/TextCommitField";
import { useApplyProps } from "@/panels/properties/use-apply-props";

type Fit = NonNullable<ImageNode["fit"]>;

const FIT_OPTIONS: readonly { value: Fit; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "crop", label: "Crop" },
  { value: "tile", label: "Tile" },
];

export const ImageSection = ({ node }: { node: ImageNode }) => {
  const nodes = useMemo(() => [node], [node]);
  const apply = useApplyProps(nodes);
  // Natural size appears once the renderer has decoded the image.
  useToolPreview((s) => s.version);
  const natural = getImageNaturalSize(node.src);

  const replace = async () => {
    const file = await pickImageFile();
    const asset = file ? await readImageFile(file) : null;
    if (asset) apply({ src: asset.src }, "Replace image");
  };

  return (
    <PropertySection title="Image">
      <PropertyRow>
        <NativeSelect
          aria-label="Image fit"
          value={node.fit ?? "fill"}
          onChange={(e) => apply({ fit: e.target.value }, "Change image fit")}
        >
          {FIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <Button variant="secondary" size="xs" className="h-7" onClick={() => void replace()}>
          Replace
        </Button>
      </PropertyRow>
      <PropertyRow>
        <PropNumber
          nodes={nodes}
          propKey="cornerRadius"
          fallback={0}
          label="R"
          labelTitle="Corner radius"
          min={0}
          history="Change corner radius"
        />
        <div />
      </PropertyRow>
      <TextCommitField
        value={node.alt ?? ""}
        label="Alt text"
        placeholder="Alt text"
        onCommit={(alt) => apply({ alt: alt.trim() || null }, "Change alt text")}
      />
      {natural ? (
        <div className="flex h-7 items-center justify-between text-xs text-muted-foreground">
          <span>
            Natural {Math.round(natural.width)} x {Math.round(natural.height)}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              apply(
                { width: Math.round(natural.width), height: Math.round(natural.height) },
                "Reset image size",
              )
            }
          >
            Reset size
          </Button>
        </div>
      ) : null}
    </PropertySection>
  );
};
