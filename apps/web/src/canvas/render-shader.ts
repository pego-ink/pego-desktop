import type { CanvasKit, RuntimeEffect, Shader } from "canvaskit-wasm";
import {
  shaderCode,
  shaderUniforms,
  withBuiltinUniforms,
  type ShaderFill,
  type Variables,
} from "@pego/doc";

type Compiled = { effect: RuntimeEffect | null; error: string | undefined };

/** Compiled shaders by source, least recently used first; a design uses few, code edits add more. */
const compiled = new Map<string, Compiled>();
const MAX_COMPILED = 32;

const compile = (ck: CanvasKit, code: string): Compiled => {
  const source = withBuiltinUniforms(code);
  const hit = compiled.get(source);
  if (hit) {
    // Least recently used goes first: move a hit to the end.
    compiled.delete(source);
    compiled.set(source, hit);
    return hit;
  }
  let error: string | undefined;
  const effect = ck.RuntimeEffect.Make(source, (message) => {
    error = message;
  });
  const entry = { effect, error: effect ? undefined : (error ?? "The shader did not compile") };
  if (compiled.size >= MAX_COMPILED) {
    const [oldest, old] = compiled.entries().next().value ?? [];
    if (oldest !== undefined) {
      old?.effect?.delete();
      compiled.delete(oldest);
    }
  }
  compiled.set(source, entry);
  return entry;
};

/** Why the fill's shader does not compile, or undefined when it does (or has no code yet). */
export const shaderError = (ck: CanvasKit, fill: ShaderFill): string | undefined => {
  const code = shaderCode(fill);
  return code.trim() === "" ? undefined : compile(ck, code).error;
};

/**
 * A Skia shader drawing `fill` over a `width` x `height` box at `time` seconds, or null when it
 * has no code or does not compile. The caller deletes it after drawing.
 */
export const makeShaderFill = (
  ck: CanvasKit,
  fill: ShaderFill,
  variables: Variables,
  width: number,
  height: number,
  time: number,
): Shader | null => {
  const code = shaderCode(fill);
  if (code.trim() === "") return null;
  const { effect } = compile(ck, code);
  if (!effect) return null;
  const values = shaderUniforms(fill, variables);
  const floats = new Float32Array(effect.getUniformFloatCount());
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const uniform = effect.getUniform(i);
    const value =
      name === "iResolution" ? [width, height] : name === "iTime" ? [time] : values.get(name);
    if (!value) continue;
    const size = uniform.columns * uniform.rows;
    // A color given to a vec4 keeps its alpha; missing components are 0, alpha 1.
    for (let k = 0; k < size; k++) floats[uniform.slot + k] = value[k] ?? (k === 3 ? 1 : 0);
  }
  return effect.makeShader(floats);
};
