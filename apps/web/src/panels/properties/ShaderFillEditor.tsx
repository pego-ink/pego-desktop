import { useEffect, useState } from "react";
import {
  SHADER_PRESETS,
  declaredUniforms,
  shaderCode,
  type ShaderFill,
  type ShaderPreset,
} from "@pego/doc";
import { NativeSelect } from "@pego/ui/components/native-select";
import { NumberField } from "@pego/ui/components/number-field";
import { Textarea } from "@pego/ui/components/textarea";
import { loadCanvasKit } from "@/canvas/load-canvaskit";
import { shaderError } from "@/canvas/render-shader";
import { PropColor } from "@/panels/properties/PropColor";

type Phase = "commit" | "extend";

const PRESET_OPTIONS = [
  ...Object.entries(SHADER_PRESETS).map(([id, info]) => [id, info.label] as const),
  ["custom", "Custom code"] as const,
];

/** Turn a uniform name into a label: `color1` -> "Color 1", `highlight` -> "Highlight". */
const uniformLabel = (name: string): string =>
  name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** The compile error of a custom shader, checked once CanvasKit is loaded. */
const useShaderError = (fill: ShaderFill): string | undefined => {
  const [checked, setChecked] = useState<{ code: string; error: string | undefined }>();
  const code = fill.preset === "custom" ? (fill.code ?? "") : "";
  useEffect(() => {
    if (code === "") return;
    let live = true;
    void loadCanvasKit().then((res) => {
      if (live) setChecked({ code, error: shaderError(res.ck, fill) });
    });
    return () => {
      live = false;
    };
    // Only the code decides whether it compiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  return code !== "" && checked?.code === code ? checked.error : undefined;
};

/** The code box: edits stay local until it loses focus, then become one undo step. */
const CodeEditor = ({ code, onCommit }: { code: string; onCommit: (code: string) => void }) => {
  const [draft, setDraft] = useState(code);
  return (
    <Textarea
      aria-label="Shader code"
      spellCheck={false}
      className="min-h-40 font-mono text-[11px] leading-snug"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== code) onCommit(draft);
      }}
    />
  );
};

/** Preset, one control per uniform and, for custom shaders, the code. */
export const ShaderFillEditor = ({
  fill,
  onChange,
}: {
  fill: ShaderFill;
  onChange: (change: (fill: ShaderFill) => ShaderFill, label: string, phase?: Phase) => void;
}) => {
  const code = shaderCode(fill);
  const error = useShaderError(fill);
  const defaults = fill.preset === "custom" ? {} : SHADER_PRESETS[fill.preset].uniforms;
  const valueOf = (name: string) => fill.uniforms?.[name] ?? defaults[name];
  const setUniform = (name: string, value: number | string, phase?: Phase) =>
    onChange((f) => ({ ...f, uniforms: { ...f.uniforms, [name]: value } }), "Change shader", phase);

  const choosePreset = (preset: ShaderPreset) =>
    onChange(
      (f) =>
        preset === "custom"
          ? // Start from the current look so it can be tweaked.
            { type: "shader", preset, code: shaderCode(f), uniforms: f.uniforms }
          : { type: "shader", preset },
      "Change shader",
    );

  return (
    <div className="flex flex-col gap-1.5">
      <NativeSelect
        aria-label="Shader"
        value={fill.preset}
        onChange={(event) => choosePreset(event.target.value as ShaderPreset)}
      >
        {PRESET_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>
      {fill.preset !== "custom" ? (
        <p className="px-0.5 text-[11px] text-muted-foreground">
          {SHADER_PRESETS[fill.preset].hint}
        </p>
      ) : null}
      {declaredUniforms(code).map(({ name, kind }) => {
        const value = valueOf(name);
        if (kind === "color") {
          return (
            <PropColor
              key={name}
              raw={typeof value === "string" ? value : "#FFFFFF"}
              label={uniformLabel(name)}
              onChange={(color, phase) => setUniform(name, color, phase)}
            >
              <span className="ml-auto truncate pr-1 text-[11px] text-muted-foreground">
                {uniformLabel(name)}
              </span>
            </PropColor>
          );
        }
        if (kind === "vector") return null;
        return (
          <NumberField
            key={name}
            label={uniformLabel(name).slice(0, 1)}
            labelTitle={uniformLabel(name)}
            value={typeof value === "number" ? value : 1}
            step={0.05}
            onChange={(next, phase) => setUniform(name, next, phase)}
          >
            <span className="truncate pr-1 text-[11px] text-muted-foreground">
              {uniformLabel(name)}
            </span>
          </NumberField>
        );
      })}
      {fill.preset === "custom" ? (
        <>
          <CodeEditor
            key={fill.code ?? ""}
            code={fill.code ?? ""}
            onCommit={(next) => onChange((f) => ({ ...f, code: next }), "Edit shader code")}
          />
          <p className="px-0.5 text-[11px] text-muted-foreground">
            vec4 main(vec2 fragCoord), with iResolution (px) and iTime (s). It moves while selected
            and during Play.
          </p>
          {error ? (
            <p
              role="alert"
              className="px-0.5 font-mono text-[11px] whitespace-pre-wrap text-destructive"
            >
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
