import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { GrDirectContext, Surface } from "canvaskit-wasm";
import { loadCanvasKit } from "@/canvas/load-canvaskit";
import { getLayout } from "@/canvas/layout";
import { renderDocument } from "@/canvas/render-document";
import { DEFAULT_CAMERA } from "@/canvas/types";
import { useDocumentStore } from "@/store/use-document-store";

export const Canvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const element = canvasRef.current;
    if (!container || !element) return;

    let disposed = false;
    let surface: Surface | null = null;
    let grContext: GrDirectContext | null = null;
    let cleanup = () => {};

    void loadCanvasKit()
      .then((res) => {
        if (disposed) return;
        const { ck } = res;

        const handle = ck.GetWebGLContext(element, { majorVersion: 2, antialias: 0 });
        grContext = handle ? ck.MakeGrContext(handle) : null;
        if (!grContext) throw new Error("WebGL2 is not available");

        const draw = () => {
          if (!surface) return;
          const dpr = window.devicePixelRatio || 1;
          const canvas = surface.getCanvas();
          canvas.save();
          canvas.scale(dpr, dpr);
          const { doc } = useDocumentStore.getState();
          renderDocument(res, canvas, doc, getLayout(doc), DEFAULT_CAMERA);
          canvas.restore();
          surface.flush();
        };

        const resize = () => {
          const dpr = window.devicePixelRatio || 1;
          const width = Math.max(Math.round(container.clientWidth * dpr), 1);
          const height = Math.max(Math.round(container.clientHeight * dpr), 1);
          if (!grContext) return;
          surface?.delete();
          element.width = width;
          element.height = height;
          surface = ck.MakeOnScreenGLSurface(grContext, width, height, ck.ColorSpace.SRGB);
          draw();
        };

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        const unsubscribe = useDocumentStore.subscribe(draw);

        cleanup = () => {
          observer.disconnect();
          unsubscribe();
          surface?.delete();
          surface = null;
          grContext?.delete();
          grContext = null;
        };
      })
      .catch((error: unknown) => {
        console.error(error);
        toast.error("Canvas failed to start");
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
};
