import { describe, expect, test } from "bun:test";
import { fillSchema } from "./schema";
import {
  SHADER_PRESETS,
  declaredUniforms,
  shaderCode,
  shaderFallbackColor,
  shaderIsAnimated,
  shaderToWebGl,
  shaderUniforms,
  withBuiltinUniforms,
} from "./shaders";

describe("shader fills", () => {
  test("the schema takes presets and custom code, and rejects unknown presets", () => {
    expect(fillSchema.safeParse({ type: "shader", preset: "aurora" }).success).toBe(true);
    expect(
      fillSchema.safeParse({
        type: "shader",
        preset: "custom",
        code: "vec4 main(vec2 p) { return vec4(1.0); }",
        uniforms: { tint: "#ff0000", amount: 0.5, offset: [1, 2] },
      }).success,
    ).toBe(true);
    expect(fillSchema.safeParse({ type: "shader", preset: "lava" }).success).toBe(false);
    expect(
      fillSchema.safeParse({ type: "shader", preset: "aurora", uniforms: { a: [1] } }).success,
    ).toBe(false);
  });

  test("code comes from the preset, or from the fill for custom", () => {
    expect(shaderCode({ type: "shader", preset: "waves" })).toBe(SHADER_PRESETS.waves.code);
    expect(shaderCode({ type: "shader", preset: "custom", code: "x" })).toBe("x");
    expect(shaderCode({ type: "shader", preset: "custom" })).toBe("");
  });

  test("every preset declares exactly the uniforms it has defaults for", () => {
    for (const info of Object.values(SHADER_PRESETS)) {
      expect(declaredUniforms(info.code).map((u) => u.name)).toEqual(Object.keys(info.uniforms));
      expect(shaderIsAnimated({ type: "shader", preset: "custom", code: info.code })).toBe(true);
    }
  });

  test("built-in uniforms are declared once", () => {
    const code = "vec4 main(vec2 p) { return vec4(iTime); }";
    expect(withBuiltinUniforms(code)).toStartWith(
      "uniform vec2 iResolution;\nuniform float iTime;\n",
    );
    const own = "uniform float iTime;\nvec4 main(vec2 p) { return vec4(iTime); }";
    expect(withBuiltinUniforms(own)).toBe(`uniform vec2 iResolution;\n${own}`);
  });

  test("uniform values: fill values over preset defaults, colors as 0..1 floats", () => {
    const values = shaderUniforms(
      { type: "shader", preset: "shimmer", uniforms: { highlight: "$light", speed: 2 } },
      { light: { type: "color", value: "#ffffff" } },
    );
    expect(values.get("color")).toEqual([229 / 255, 231 / 255, 235 / 255, 1]);
    expect(values.get("highlight")).toEqual([1, 1, 1, 1]);
    expect(values.get("speed")).toEqual([2]);
    const short = shaderUniforms(
      { type: "shader", preset: "custom", uniforms: { c: "#f008", v: [1, 2] } },
      {},
    );
    expect(short.get("c")).toEqual([1, 0, 0, 0x88 / 255]);
    expect(short.get("v")).toEqual([1, 2]);
    const fromVariables = shaderUniforms(
      { type: "shader", preset: "waves", uniforms: { lines: "$count", color: "$brand" } },
      {
        count: { type: "number", value: 20 },
        brand: { type: "color", value: "#ff0000" },
      },
    );
    expect(fromVariables.get("lines")).toEqual([20]);
    expect(fromVariables.get("color")).toEqual([1, 0, 0, 1]);
  });

  test("the fallback color is the first color uniform", () => {
    expect(shaderFallbackColor({ type: "shader", preset: "aurora" }, {})).toBe("#0F172A");
    expect(
      shaderFallbackColor(
        { type: "shader", preset: "aurora", uniforms: { color1: "#123456" } },
        {},
      ),
    ).toBe("#123456");
    expect(shaderFallbackColor({ type: "shader", preset: "custom" }, {})).toBe("#000000");
  });

  test("declared uniforms: numbers, colors and vectors, built-ins left out", () => {
    const code =
      "uniform float iTime;\nuniform half amount;\nuniform float3 tint;\nuniform vec4 glow;\nuniform vec2 offset;";
    expect(declaredUniforms(code)).toEqual([
      { name: "amount", kind: "number" },
      { name: "tint", kind: "color" },
      { name: "glow", kind: "color" },
      { name: "offset", kind: "vector" },
    ]);
  });

  test("WebGL translation: GLSL types, a renamed main and a CSS-px fragCoord", () => {
    const glsl = shaderToWebGl(
      "uniform half3 tint;\nhalf4 main(float2 p) { float2x2 m; return half4(tint, 1); }",
    );
    expect(glsl).toStartWith("precision highp float;\nuniform float pegoPixelRatio;\n");
    expect(glsl).toContain("uniform vec2 iResolution;\nuniform float iTime;");
    expect(glsl).toContain("uniform vec3 tint;");
    expect(glsl).toContain("vec4 pego_main(vec2 p) { mat2 m; return vec4(tint, 1); }");
    expect(glsl).toContain("gl_FragColor = pego_main(css);");
    expect(glsl).not.toMatch(/\bhalf|float[234]\b/);
  });

  test("WebGL translation renames the real main, not one in a comment", () => {
    const glsl = shaderToWebGl(
      "// vec4 main(vec2 p) is the entry point\n/* main( */\nvec4 main(vec2 p) { return vec4(1.0); }",
    );
    expect(glsl).toContain("vec4 pego_main(vec2 p) { return vec4(1.0); }");
    expect(glsl.match(/\bmain\s*\(/g)).toEqual(["main("]);
  });
});
