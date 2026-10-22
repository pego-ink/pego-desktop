import { ItalicIcon } from "lucide-react";
import { type TextNode } from "@pego/doc";
import { NativeSelect } from "@pego/ui/components/native-select";
import { cn } from "@pego/ui/lib/utils";
import { findFontFamily } from "@/fonts/font-service";
import type { FontStyle } from "@/fonts/types";
import { commonValue } from "@/panels/mixed-value";
import { PropNumber } from "@/panels/properties/PropNumber";
import { variableOf } from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";
import { useLoadFaces } from "@/panels/properties/font/use-load-faces";
import {
  allWeights,
  DEFAULT_FAMILY,
  hasItalicAt,
  resolveFace,
  weightLabel,
} from "@/panels/properties/font/font-utils";

const STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const familyOf = (node: TextNode) => node.fontFamily ?? DEFAULT_FAMILY;
const numericWeight = (node: TextNode) =>
  typeof node.fontWeight === "number" ? node.fontWeight : 400;
const styleOf = (node: TextNode): FontStyle => node.fontStyle ?? "normal";

type Props = {
  nodes: readonly TextNode[];
  /** True once the catalog loaded: a family missing from it is then a custom font. */
  catalogReady: boolean;
};

/** Weight select (only the weights the family has) and italic toggle, for every selected text node. */
export const FontStyleControls = ({ nodes, catalogReady }: Props) => {
  const apply = useApplyProps(nodes);
  const loadFaces = useLoadFaces();
  const family = commonValue(nodes.map(familyOf));
  const weight = commonValue(nodes.map((node) => node.fontWeight ?? 400));
  const style = commonValue(nodes.map(styleOf));
  const info = family.kind === "same" ? findFontFamily(family.value) : undefined;
  const custom = catalogReady && family.kind === "same" && !info;
  const weightVariable = weight.kind === "same" ? variableOf(weight.value) : undefined;
  const weightNumber =
    weight.kind === "same" && typeof weight.value === "number" ? weight.value : undefined;
  const italic = style.kind === "same" && style.value === "italic";
  const options: readonly number[] = info ? allWeights(info) : STANDARD_WEIGHTS;
  const italicDisabled = !italic && info !== undefined && !hasItalicAt(info, weightNumber ?? 400);

  const commit = (
    change: (node: TextNode) => { fontWeight?: number; fontStyle?: FontStyle },
    label: string,
  ) => {
    const changes = new Map(nodes.map((node) => [node.id, change(node)]));
    apply((node) => changes.get(node.id) ?? {}, label);
    loadFaces(
      nodes.map((node) => {
        const props = changes.get(node.id);
        return {
          family: familyOf(node),
          weight: props?.fontWeight ?? numericWeight(node),
          style: props?.fontStyle ?? styleOf(node),
        };
      }),
    );
  };

  const setWeight = (value: number) =>
    commit((node) => {
      const nodeInfo = findFontFamily(familyOf(node));
      if (!nodeInfo) return { fontWeight: value };
      const face = resolveFace(nodeInfo, value, styleOf(node));
      return { fontWeight: face.weight, fontStyle: face.style };
    }, "Change font weight");

  const toggleItalic = () =>
    commit(
      () => ({ fontStyle: italic ? "normal" : "italic" }),
      italic ? "Remove italic" : "Italic",
    );

  return (
    <div className="flex gap-2">
      {custom ? (
        <PropNumber
          nodes={nodes}
          propKey="fontWeight"
          fallback={400}
          label="W"
          labelTitle="Font weight"
          min={1}
          max={1000}
          history="Change font weight"
        />
      ) : (
        <NativeSelect
          aria-label="Font weight"
          value={weight.kind === "same" ? String(weight.value) : "mixed"}
          onChange={(event) => setWeight(Number(event.target.value))}
        >
          {weight.kind === "mixed" ? (
            <option value="mixed" disabled>
              Mixed
            </option>
          ) : null}
          {weightVariable ? <option value={weightVariable}>{weightVariable}</option> : null}
          {weightNumber !== undefined && !options.includes(weightNumber) ? (
            <option value={String(weightNumber)}>{weightLabel(weightNumber)}</option>
          ) : null}
          {options.map((value) => (
            <option key={value} value={value}>
              {weightLabel(value)}
            </option>
          ))}
        </NativeSelect>
      )}
      <button
        type="button"
        aria-label="Italic"
        title={italicDisabled ? "No italic at this weight" : "Italic"}
        aria-pressed={italic}
        disabled={italicDisabled}
        onClick={toggleItalic}
        className={cn(
          "flex h-7 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
          italic && "bg-secondary text-foreground shadow-xs",
        )}
      >
        <ItalicIcon />
      </button>
    </div>
  );
};
