import { MinusIcon, PlusIcon, SquareDashedIcon } from "lucide-react";
import type { Effect, PegoNode, ShadowEffect, Stroke } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { PropColor } from "@/panels/properties/PropColor";
import { PropNumber, RawNumberField } from "@/panels/properties/PropNumber";
import {
  DEFAULT_SHADOW,
  DEFAULT_STROKE,
  hasCornerRadius,
  rawProp,
} from "@/panels/properties/node-props";
import { useApplyProps } from "@/panels/properties/use-apply-props";

const SectionButton = ({
  label,
  onClick,
  remove,
}: {
  label: string;
  onClick: () => void;
  remove?: boolean;
}) => (
  <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick}>
    {remove ? <MinusIcon /> : <PlusIcon />}
  </Button>
);

export const AppearanceSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  if (!hasCornerRadius(node)) return null;
  return (
    <PropertySection title="Appearance">
      <PropertyRow>
        <PropNumber
          nodes={[node]}
          propKey="cornerRadius"
          label={<SquareDashedIcon />}
          labelTitle="Corner radius"
          min={0}
          history="Change corner radius"
        />
        {node.type === "frame" ? (
          <label className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={node.clip === true}
              onChange={(event) => apply({ clip: event.target.checked }, "Toggle clip")}
            />
            Clip content
          </label>
        ) : null}
      </PropertyRow>
    </PropertySection>
  );
};

export const StrokeSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const stroke = rawProp(node, "stroke") as Stroke | undefined;
  return (
    <PropertySection
      title="Stroke"
      action={
        stroke === undefined ? (
          <SectionButton
            label="Add stroke"
            onClick={() => apply({ stroke: DEFAULT_STROKE }, "Add stroke")}
          />
        ) : (
          <SectionButton
            label="Remove stroke"
            remove
            onClick={() => apply({ stroke: null }, "Remove stroke")}
          />
        )
      }
    >
      {stroke === undefined ? null : (
        <PropertyRow className="grid-cols-[1fr_5.5rem]">
          <PropColor
            raw={stroke.color}
            label="Stroke color"
            onChange={(color, phase) =>
              apply(
                (n) => ({ stroke: { ...(rawProp(n, "stroke") as Stroke), color } }),
                "Change stroke",
                phase,
              )
            }
          />
          <StrokeWidth node={node} />
        </PropertyRow>
      )}
    </PropertySection>
  );
};

/**
 * Stroke width lives inside the `stroke` object, so it needs its own update shape. Per-side
 * widths show as mixed; typing a value sets every side.
 */
const StrokeWidth = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const stroke = rawProp(node, "stroke") as Stroke;
  const perSide = Array.isArray(stroke.width);
  return (
    <RawNumberField
      raw={perSide ? undefined : (stroke.width as number | string)}
      mixed={perSide}
      fallback={1}
      min={0}
      label="W"
      labelTitle="Stroke width"
      onChange={(width, phase) =>
        apply(
          (n) => ({ stroke: { ...(rawProp(n, "stroke") as Stroke), width } }),
          "Change stroke width",
          phase,
        )
      }
    />
  );
};

type EffectKind = "drop" | "inner" | "blur";

const EFFECT_KINDS: readonly [EffectKind, string][] = [
  ["drop", "Drop shadow"],
  ["inner", "Inner shadow"],
  ["blur", "Layer blur"],
];

const kindOf = (effect: Effect): EffectKind =>
  effect.type === "blur" ? "blur" : effect.inner ? "inner" : "drop";

/** Switch an effect's kind, keeping what carries over (color and offsets between shadows). */
const withKind = (effect: Effect, kind: EffectKind): Effect => {
  if (kind === "blur") return { type: "blur", radius: effect.type === "blur" ? effect.radius : 4 };
  const shadow: ShadowEffect = { ...(effect.type === "shadow" ? effect : DEFAULT_SHADOW) };
  if (kind === "inner") shadow.inner = true;
  else delete shadow.inner;
  return shadow;
};

/** Shadows and layer blur. Edits replace the whole `effects` list. */
export const EffectsSection = ({ node }: { node: PegoNode }) => {
  const apply = useApplyProps([node]);
  const effects = (rawProp(node, "effects") as Effect[] | undefined) ?? [];
  const update = (
    index: number,
    change: (effect: Effect) => Effect | null,
    label: string,
    phase?: Parameters<typeof apply>[2],
  ) =>
    apply(
      (n) => {
        const current = (rawProp(n, "effects") as Effect[] | undefined) ?? [];
        const next = current.flatMap((effect, i) => {
          if (i !== index) return [effect];
          const changed = change(effect);
          return changed ? [changed] : [];
        });
        return { effects: next.length > 0 ? next : null };
      },
      label,
      phase,
    );

  return (
    <PropertySection
      title="Effects"
      action={
        <SectionButton
          label="Add effect"
          onClick={() => apply({ effects: [...effects, DEFAULT_SHADOW] }, "Add effect")}
        />
      }
    >
      {effects.map((effect, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <PropertyRow className="grid-cols-[1fr_auto]">
            <NativeSelect
              aria-label="Effect type"
              value={kindOf(effect)}
              onChange={(event) =>
                update(
                  index,
                  (e) => withKind(e, event.target.value as EffectKind),
                  "Change effect type",
                )
              }
            >
              {EFFECT_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <SectionButton
              label="Remove effect"
              remove
              onClick={() => update(index, () => null, "Remove effect")}
            />
          </PropertyRow>
          {effect.type === "blur" ? (
            <RawNumberField
              raw={effect.radius}
              min={0}
              label="R"
              labelTitle="Blur radius"
              onChange={(radius, phase) =>
                update(index, (e) => ({ ...e, radius }) as Effect, "Change blur", phase)
              }
            />
          ) : (
            <>
              <PropColor
                raw={effect.color}
                label="Shadow color"
                onChange={(color, phase) =>
                  update(index, (e) => ({ ...e, color }) as Effect, "Change shadow color", phase)
                }
              />
              <PropertyRow>
                {(["x", "y"] as const).map((key) => (
                  <RawNumberField
                    key={key}
                    raw={effect[key]}
                    label={key.toUpperCase()}
                    labelTitle={`Shadow ${key} offset`}
                    onChange={(value, phase) =>
                      update(
                        index,
                        (e) => ({ ...e, [key]: value }) as Effect,
                        "Change shadow",
                        phase,
                      )
                    }
                  />
                ))}
              </PropertyRow>
              <PropertyRow>
                <RawNumberField
                  raw={effect.blur}
                  min={0}
                  label="B"
                  labelTitle="Shadow blur"
                  onChange={(blur, phase) =>
                    update(index, (e) => ({ ...e, blur }) as Effect, "Change shadow", phase)
                  }
                />
                <RawNumberField
                  raw={effect.spread}
                  label="S"
                  labelTitle="Shadow spread"
                  onChange={(spread, phase) =>
                    update(index, (e) => ({ ...e, spread }) as Effect, "Change shadow", phase)
                  }
                />
              </PropertyRow>
            </>
          )}
        </div>
      ))}
    </PropertySection>
  );
};
