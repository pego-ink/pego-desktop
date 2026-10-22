import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { GrDirectContext, Surface } from "canvaskit-wasm";
import { loadCanvasKit } from "@/canvas/load-canvaskit";
import { getLayout } from "@/canvas/layout";
import { renderDocument } from "@/canvas/render-document";
import { renderOverlay } from "@/canvas/render-overlay";
import { useAgentStore } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { contentBounds } from "@/interaction/camera";
import { deriveCursor, useInteractionState } from "@/interaction/interaction-state";
import { useCanvasPointer } from "@/interaction/use-canvas-pointer";
import { AgentCursor } from "@/components/AgentCursor";
import { TextEditorOverlay } from "@/components/TextEditorOverlay";
import { Toolbar } from "@/components/Toolbar";
import { useDocumentStore } from "@/store/use-document-store";
import { useFontEvents } from "@/fonts/font-events";
import { getToolHandler, useToolPreview } from "@/interaction/tool-handlers";
import { useTextEditStore } from "@/store/use-text-edit-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";

export const Canvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useCanvasPointer(canvasRef);
  useEditorShortcuts();

  // Cursor follows interaction state without re-rendering React.
  useEffect(() => {
    const apply = () => {
      const element = canvasRef.current;
      if (element)
        element.style.cursor = deriveCursor(
          useInteractionState.getState(),
          useToolStore.getState().tool,
        );
    };
    apply();
    const unsubscribers = [useInteractionState.subscribe(apply), useToolStore.subscribe(apply)];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const element = canvasRef.current;
    if (!container || !element) return;

    let disposed = false;
    let surface: Surface | null = null;
    let grContext: GrDirectContext | null = null;
    let frame = 0;
    let cleanup = () => {};

    void loadCanvasKit()
      .then((res) => {
        if (disposed) return;
        const { ck } = res;

        const handle = ck.GetWebGLContext(element, { majorVersion: 2, antialias: 0 });
        grContext = handle ? ck.MakeGrContext(handle) : null;
        if (!grContext) throw new Error("WebGL2 is not available");

        const draw = () => {
          frame = 0;
          if (!surface) return;
          const dpr = window.devicePixelRatio || 1;
          const canvas = surface.getCanvas();
          const { doc, selection, hoveredId } = useDocumentStore.getState();
          const { camera } = useViewportStore.getState();
          const { marquee } = useInteractionState.getState();
          const layout = getLayout(doc);
          canvas.save();
          canvas.scale(dpr, dpr);
          const editing = useTextEditStore.getState().target;
          const hiddenIds = editing?.mode === "edit" ? new Set([editing.id]) : undefined;
          renderDocument(res, canvas, doc, layout, camera, { hiddenIds });
          const agent = useAgentStore.getState();
          const agentFocusIds = isRunActive(agent.status) ? agent.focusIds : undefined;
          renderOverlay(res, canvas, {
            layout,
            camera,
            selection,
            hoveredId,
            marquee,
            agentFocusIds,
          });
          getToolHandler(useToolStore.getState().tool)?.renderOverlay?.(res, canvas, camera);
          canvas.restore();
          surface.flush();
        };
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(draw);
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
          const viewport = useViewportStore.getState();
          viewport.setSize(container.clientWidth, container.clientHeight);
          if (!viewport.fitted) {
            const { doc } = useDocumentStore.getState();
            viewport.zoomToFit(contentBounds(doc, getLayout(doc)));
          }
          draw();
        };

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        const unsubscribers = [
          useDocumentStore.subscribe(schedule),
          useViewportStore.subscribe(schedule),
          useInteractionState.subscribe(schedule),
          useTextEditStore.subscribe(schedule),
          useFontEvents.subscribe(schedule),
          useToolPreview.subscribe(schedule),
          useToolStore.subscribe(schedule),
          useAgentStore.subscribe((state, prev) => {
            if (state.focusIds !== prev.focusIds || state.status !== prev.status) schedule();
          }),
        ];

        cleanup = () => {
          observer.disconnect();
          for (const unsubscribe of unsubscribers) unsubscribe();
          if (frame) cancelAnimationFrame(frame);
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <TextEditorOverlay />
      <AgentCursor />
      <Toolbar />
    </div>
  );
};
