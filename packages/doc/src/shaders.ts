import { resolveColor } from "./resolve";
import type { ShaderFill, ShaderPreset, ShaderUniformValue, Variables } from "./schema";

/**
 * Shader fills: a fragment shader paints the shape, drawn by Skia on the canvas and by WebGL in
 * exported HTML. Code is the GLSL-style subset both understand: `vec4 main(vec2 fragCoord)` with
 * `fragCoord` in px from the shape's top-left, plain `float` / `vec2-4` uniforms, no textures.
 * `iResolution` (the shape size in px) and `iTime` (seconds) are provided; a shader that reads
 * `iTime` moves while its layer is selected and during Play.
 */

type PresetUniform = number | readonly number[] | string;

export type ShaderPresetInfo = {
  label: string;
  /** What it looks like, for the panel and the agent. */
  hint: string;
  code: string;
  /** Default value of every uniform the code declares, in panel order. */
  uniforms: Readonly<Record<string, PresetUniform>>;
};

const AURORA = `uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform float speed;

vec4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  float t = iTime * speed;
  float a = sin(uv.x * 3.0 + t * 0.7 + sin(uv.y * 2.0 - t * 0.5) * 1.5) * 0.5 + 0.5;
  float b = sin(uv.y * 4.0 - t * 0.6 + sin(uv.x * 3.0 + t * 0.4) * 1.2) * 0.5 + 0.5;
  vec3 col = mix(color1, color2, smoothstep(0.1, 0.9, a));
  col = mix(col, color3, smoothstep(0.3, 1.0, b) * 0.7);
  return vec4(col, 1.0);
}`;

const GRADIENT_FLOW = `uniform vec3 background;
uniform vec3 color1;
uniform vec3 color2;
uniform float speed;

vec4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  float t = iTime * speed;
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 q = vec2(uv.x * aspect, uv.y);
  vec2 p1 = vec2((0.3 + 0.2 * sin(t * 0.8)) * aspect, 0.35 + 0.2 * cos(t * 0.6));
  vec2 p2 = vec2((0.7 + 0.2 * cos(t * 0.7)) * aspect, 0.65 + 0.2 * sin(t * 0.9));
  float d1 = length(q - p1);
  float d2 = length(q - p2);
  vec3 col = background;
  col = mix(col, color1, exp(-d1 * d1 * 6.0));
  col = mix(col, color2, exp(-d2 * d2 * 6.0));
  return vec4(col, 1.0);
}`;

const WAVES = `uniform vec3 background;
uniform vec3 color;
uniform float lines;
uniform float speed;

vec4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  float t = iTime * speed;
  float y = uv.y * lines + sin(uv.x * 6.2832 + t) * 0.35 + sin(uv.x * 12.0 - t * 1.3) * 0.15;
  float dist = abs(fract(y) - 0.5);
  float thick = 1.5 * lines / max(iResolution.y, 1.0);
  float m = 1.0 - smoothstep(thick * 0.5, thick, dist);
  return vec4(mix(background, color, m), 1.0);
}`;

const GRAIN = `uniform vec3 color;
uniform float amount;
uniform float speed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 main(vec2 fragCoord) {
  float n = hash(floor(fragCoord) + floor(iTime * speed * 24.0));
  vec3 col = color + (n - 0.5) * amount;
  return vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const SHIMMER = `uniform vec3 color;
uniform vec3 highlight;
uniform float speed;

vec4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  float x = uv.x + uv.y * 0.35;
  float pos = fract(iTime * speed * 0.4) * 2.2 - 0.6;
  float d = (x - pos) * 6.0;
  return vec4(mix(color, highlight, exp(-d * d)), 1.0);
}`;

const DOTS = `uniform vec3 background;
uniform vec3 color;
uniform float spacing;
uniform float speed;

vec4 main(vec2 fragCoord) {
  vec2 grid = fragCoord / max(spacing, 2.0);
  vec2 cell = floor(grid);
  float phase = sin(iTime * speed * 2.0 - (cell.x + cell.y) * 0.45) * 0.5 + 0.5;
  float r = 0.12 + 0.18 * phase;
  float d = length(fract(grid) - 0.5);
  float m = 1.0 - smoothstep(r - 0.04, r, d);
  return vec4(mix(background, color, m), 1.0);
}`;

export const SHADER_PRESETS: Readonly<Record<Exclude<ShaderPreset, "custom">, ShaderPresetInfo>> = {
  aurora: {
    label: "Aurora",
    hint: "Soft bands of three colors drifting like northern lights",
    code: AURORA,
    uniforms: { color1: "#0F172A", color2: "#4F46E5", color3: "#22D3EE", speed: 0.6 },
  },
  gradient_flow: {
    label: "Gradient flow",
    hint: "Two blurred color blobs wandering over a background",
    code: GRADIENT_FLOW,
    uniforms: { background: "#FDF2F8", color1: "#F472B6", color2: "#818CF8", speed: 0.5 },
  },
  waves: {
    label: "Waves",
    hint: "Thin wavy lines that ripple sideways",
    code: WAVES,
    uniforms: { background: "#0B1120", color: "#38BDF8", lines: 14, speed: 0.8 },
  },
  grain: {
    label: "Film grain",
    hint: "A flat color with living noise, for texture",
    code: GRAIN,
    uniforms: { color: "#1C1917", amount: 0.12, speed: 1 },
  },
  shimmer: {
    label: "Shimmer",
    hint: "A light sweep across a color, like a loading skeleton",
    code: SHIMMER,
    uniforms: { color: "#E5E7EB", highlight: "#F9FAFB", speed: 1 },
  },
  dots: {
    label: "Pulsing dots",
    hint: "A dot grid that breathes in a diagonal wave",
    code: DOTS,
    uniforms: { background: "#111827", color: "#A3E635", spacing: 18, speed: 1 },
  },
};

/** Uniforms Pego fills in itself. */
export const BUILTIN_UNIFORMS = ["iResolution", "iTime"] as const;

/** The shader code of a fill: its preset's, or its own for `custom` (empty when missing). */
export const shaderCode = (fill: ShaderFill): string =>
  fill.preset === "custom" ? (fill.code ?? "") : SHADER_PRESETS[fill.preset].code;

/** `code` with `iResolution` / `iTime` declared unless it declares them itself. */
export const withBuiltinUniforms = (code: string): string => {
  const missing = [
    /\buniform\s+\w+\s+iResolution\b/.test(code) ? null : "uniform vec2 iResolution;",
    /\buniform\s+\w+\s+iTime\b/.test(code) ? null : "uniform float iTime;",
  ].filter((line): line is string => line !== null);
  return missing.length > 0 ? `${missing.join("\n")}\n${code}` : code;
};

/** Whether the shader moves on its own (reads `iTime`). */
export const shaderIsAnimated = (fill: ShaderFill): boolean => /\biTime\b/.test(shaderCode(fill));

const hexToFloats = (hex: string): number[] => {
  const h = hex.slice(1);
  const full =
    h.length <= 4
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const channels = [0, 2, 4, 6].map((i) =>
    i < full.length ? parseInt(full.slice(i, i + 2), 16) / 255 : 1,
  );
  return channels;
};

const toFloats = (value: ShaderUniformValue | PresetUniform, variables: Variables): number[] => {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return [...value];
  const color = resolveColor(value as string, variables);
  return color ? hexToFloats(color) : [0, 0, 0, 1];
};

/**
 * The fill's uniform values as floats (colors become r, g, b, a in 0..1), its own values over the
 * preset defaults. Built-in uniforms are not included.
 */
export const shaderUniforms = (fill: ShaderFill, variables: Variables): Map<string, number[]> => {
  const defaults = fill.preset === "custom" ? {} : SHADER_PRESETS[fill.preset].uniforms;
  const values = new Map<string, number[]>();
  for (const [name, value] of Object.entries({ ...defaults, ...fill.uniforms })) {
    values.set(name, toFloats(value, variables));
  }
  return values;
};

/** The first color the fill uses, for places that cannot run shaders (SVG, a CSS fallback). */
export const shaderFallbackColor = (fill: ShaderFill, variables: Variables): string => {
  const defaults = fill.preset === "custom" ? {} : SHADER_PRESETS[fill.preset].uniforms;
  for (const value of Object.values({ ...defaults, ...fill.uniforms })) {
    if (typeof value !== "string") continue;
    const color = resolveColor(value, variables);
    if (color) return color;
  }
  return "#000000";
};

const SKSL_TYPES: readonly [RegExp, string][] = [
  [/\b(?:half|float)([234])x([234])\b/g, "mat$1"],
  [/\b(?:half|float)([234])\b/g, "vec$1"],
  [/\bhalf\b/g, "float"],
  [/\bshort([234])\b/g, "ivec$1"],
  [/\bint([234])\b/g, "ivec$1"],
  [/\bbool([234])\b/g, "bvec$1"],
];

/**
 * A WebGL 1 fragment shader running `code`: SkSL type names become GLSL ones, `main` becomes a
 * helper called with `fragCoord` in CSS px from the top-left (`pegoPixelRatio` maps device pixels).
 */
export const shaderToWebGl = (code: string): string => {
  let body = withBuiltinUniforms(code);
  for (const [pattern, replacement] of SKSL_TYPES) body = body.replace(pattern, replacement);
  body = body.replace(/\bmain\s*\(/, "pego_main(");
  return [
    "precision highp float;",
    "uniform float pegoPixelRatio;",
    body,
    "void main() {",
    "  vec2 css = vec2(gl_FragCoord.x, iResolution.y * pegoPixelRatio - gl_FragCoord.y) / pegoPixelRatio;",
    "  gl_FragColor = pego_main(css);",
    "}",
  ].join("\n");
};

export type DeclaredUniform = { name: string; kind: "number" | "color" | "vector" };

/**
 * The uniforms `code` declares besides the built-in ones, in order: floats are numbers, vec3 and
 * vec4 colors, vec2 a vector. Used to show one control per uniform.
 */
export const declaredUniforms = (code: string): DeclaredUniform[] => {
  const found: DeclaredUniform[] = [];
  const pattern =
    /\buniform\s+(float|half|vec2|vec3|vec4|float2|float3|float4|half2|half3|half4)\s+(\w+)\s*;/g;
  for (const [, type = "", name = ""] of code.matchAll(pattern)) {
    if ((BUILTIN_UNIFORMS as readonly string[]).includes(name)) continue;
    if (found.some((u) => u.name === name)) continue;
    const kind = /[34]$/.test(type) ? "color" : /2$/.test(type) ? "vector" : "number";
    found.push({ name, kind });
  }
  return found;
};
