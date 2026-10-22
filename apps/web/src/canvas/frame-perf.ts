/** Dev-only frame timing, read from the console as `window.__pegoPerf`. Tree-shaken in production. */
type PerfLog = { enabled: boolean; samples: number[]; reset: () => void };

declare global {
  interface Window {
    __pegoPerf?: PerfLog;
  }
}

const log: PerfLog = {
  enabled: false,
  samples: [],
  reset: () => {
    log.samples.length = 0;
  },
};

if (import.meta.env.DEV && typeof window !== "undefined") window.__pegoPerf = log;

/**
 * Time one frame including GPU completion (`gl.finish`) while `window.__pegoPerf.enabled` is true.
 * Costs nothing otherwise.
 */
export const timeFrame = (gl: WebGL2RenderingContext | null, draw: () => void): void => {
  if (!import.meta.env.DEV || !log.enabled) return draw();
  const start = performance.now();
  draw();
  gl?.finish();
  log.samples.push(performance.now() - start);
};
