import {
  shaderCode,
  shaderFallbackColor,
  shaderIsAnimated,
  shaderToWebGl,
  shaderUniforms,
  type Fill,
} from "@pego/doc";
import type { Attr, BuildCtx, Decl } from "./ir";

// Shader fills in code: the element keeps a solid fallback background and carries its WebGL
// shader in `data-pego-shader`; a small runtime draws it into a canvas behind the content.

/** The fallback background of a shader fill. */
export const shaderFillDecls = (fill: Extract<Fill, { type: "shader" }>, ctx: BuildCtx): Decl[] => [
  ["background-color", shaderFallbackColor(fill, ctx.doc.variables).toLowerCase()],
];

/** `data-pego-shader` for an element filled with a shader (and marks the runtime as needed). */
export const shaderAttrs = (fill: Fill | undefined, ctx: BuildCtx): Attr[] => {
  if (typeof fill !== "object" || fill.type !== "shader") return [];
  const code = shaderCode(fill);
  if (code.trim() === "") return [];
  ctx.shaders = true;
  const spec = {
    glsl: shaderToWebGl(code),
    uniforms: Object.fromEntries(shaderUniforms(fill, ctx.doc.variables)),
    animated: shaderIsAnimated(fill),
  };
  return [["data-pego-shader", JSON.stringify(spec)]];
};

/**
 * `(root) => stop`: starts every `[data-pego-shader]` element under `root` (a canvas behind its
 * children, animated unless the visitor prefers reduced motion) and returns a function that stops
 * them. Plain JavaScript, used as-is by the HTML page and the React helper.
 */
export const SHADER_RUNTIME = `(root) => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stops = [];
  const SIZES = { 5126: 1, 35664: 2, 35665: 3, 35666: 4 };
  for (const el of root.querySelectorAll("[data-pego-shader]")) {
    const spec = JSON.parse(el.dataset.pegoShader);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "-1",
      borderRadius: "inherit",
      pointerEvents: "none",
    });
    const gl = canvas.getContext("webgl");
    if (!gl) continue;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, spec.glsl));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) continue;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.isolation = "isolate";
    el.prepend(canvas);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const sizes = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program, i);
      sizes[info.name] = SIZES[info.type] || 1;
    }
    const set = (name, value) => {
      const where = gl.getUniformLocation(program, name);
      const size = sizes[name];
      if (!where || !size) return;
      const v = [0, 1, 2, 3].slice(0, size).map((i) => value[i] ?? 1);
      [gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][size - 1].call(gl, where, ...v);
    };
    for (const [name, value] of Object.entries(spec.uniforms)) set(name, value);
    const start = performance.now();
    let frame = 0;
    const draw = () => {
      const ratio = devicePixelRatio || 1;
      const width = el.clientWidth;
      const height = el.clientHeight;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      set("iResolution", [width, height]);
      set("pegoPixelRatio", [ratio]);
      set("iTime", [(performance.now() - start) / 1000]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (spec.animated && !still) frame = requestAnimationFrame(draw);
    };
    draw();
    const resize = new ResizeObserver(() => {
      if (!spec.animated || still) draw();
    });
    resize.observe(el);
    stops.push(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.remove();
    });
  }
  return () => stops.forEach((stop) => stop());
}`;
