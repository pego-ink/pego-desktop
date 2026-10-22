import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Layout, PegoDocument } from "@pego/doc";
import { prefersReducedMotion } from "@pego/ui/lib/motion";
import type { GrDirectContext, Image as SkImage, Surface } from "canvaskit-wasm";
import { loadCanvasKit } from "@/canvas/load-canvaskit";
import { CANVAS_BACKGROUND, useThemeStore } from "@/theme/theme";
import { getLayout } from "@/canvas/layout";
import { useLayerEvents } from "@/canvas/layer-events";
import { renderDocument } from "@/canvas/render-document";
import { renderOverlay } from "@/canvas/render-overlay";
import { timeFrame } from "@/canvas/frame-perf";
import { useAgentStore } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import { contentBounds } from "@/interaction/camera";
import { deriveCursor, useInteractionState } from "@/interaction/interaction-state";
import { useCanvasPointer } from "@/interaction/use-canvas-pointer";
import { useImagePaste } from "@/interaction/use-image-paste";
import { AgentCursor } from "@/components/AgentCursor";
import { dropFiles } from "@/interaction/drop-files";
import { TextEditorOverlay } from "@/components/TextEditorOverlay";
import { Toolbar } from "@/components/Toolbar";
import { useDocumentStore } from "@/store/use-document-store";
import { useFontEvents } from "@/fonts/font-events";
import { getToolHandler, useToolPreview } from "@/interaction/tool-handlers";
import { useTextEditStore } from "@/store/use-text-edit-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Everything the cached document layer depends on; any change forces a re-render of the layer. */
type LayerKey = {
  doc: PegoDocument;
  layout: Layout;
  panX: number;
  panY: number;
  zoom: number;
  width: number;
  height: number;
  hiddenId: string | null;
  pageId: string | null;
  background: string;
  fonts: number;
  layers: number;
};

const sameKey = (a: LayerKey | null, b: LayerKey): boolean =>
  a !== null &&
  a.doc === b.doc &&
  a.layout === b.layout &&
  a.panX === b.panX &&
  a.panY === b.panY &&
  a.zoom === b.zoom &&
  a.width === b.width &&
  a.height === b.height &&
  a.hiddenId === b.hiddenId &&
  a.pageId === b.pageId &&
  a.background === b.background &&
  a.fonts === b.fonts &&
  a.layers === b.layers;

export const Canvas = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropping, setDropping] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useCanvasPointer(canvasRef);
  useImagePaste();
  useEditorShortcuts();

  // Cursor follows interaction state without re-rendering React. The active tool's own cursor
  // wins over the tool table, except while panning (space, hand drag).
  useEffect(() => {
    const apply = () => {
      const element = canvasRef.current;
      if (!element) return;
      const ui = useInteractionState.getState();
      const tool = useToolStore.getState().tool;
      const toolCursor = ui.panning || ui.spaceDown ? undefined : getToolHandler(tool)?.cursor;
      element.style.cursor = toolCursor ?? deriveCursor(ui, tool);
    };
    apply();
    const unsubscribers = [
      useInteractionState.subscribe(apply),
      useToolStore.subscribe(apply),
      useToolPreview.subscribe(apply),
    ];
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
        const context = handle ? ck.MakeGrContext(handle) : null;
        if (!context) throw new Error("WebGL2 is not available");
        grContext = context;

        // Cached document layer: an offscreen render target plus its snapshot. Hover, selection,
        // marquee and tool previews only blit it and redraw the overlay.
        let layer: Surface | null = null;
        let layerImage: SkImage | null = null;
        let layerKey: LayerKey | null = null;
        let pixelWidth = 0;
        let pixelHeight = 0;
        let cssWidth = 0;
        let cssHeight = 0;

        const dropLayer = () => {
          layerImage?.delete();
          layerImage = null;
          layer?.delete();
          layer = null;
          layerKey = null;
        };

        /** The document drawn into the cache (or straight to the screen when no cache exists). */
        const paintDocument = (
          target: Surface,
          dpr: number,
          key: LayerKey,
          hiddenIds: ReadonlySet<string> | undefined,
        ) => {
          const canvas = target.getCanvas();
          canvas.save();
          canvas.scale(dpr, dpr);
          renderDocument(
            res,
            canvas,
            key.doc,
            key.layout,
            { panX: key.panX, panY: key.panY, zoom: key.zoom },
            { hiddenIds, pageId: key.pageId, background: key.background },
          );
          canvas.restore();
        };

        const drawFrame = () => {
          if (!surface) return;
          const dpr = window.devicePixelRatio || 1;
          const canvas = surface.getCanvas();
          const { doc, selection, hoveredId, pageId } = useDocumentStore.getState();
          const { camera } = useViewportStore.getState();
          const { marquee, dropLine } = useInteractionState.getState();
          const layout = getLayout(doc);
          const editing = useTextEditStore.getState().target;
          const hiddenId = editing?.mode === "edit" ? editing.id : null;
          const hiddenIds = hiddenId ? new Set([hiddenId]) : undefined;
          const key: LayerKey = {
            doc,
            layout,
            panX: camera.panX,
            panY: camera.panY,
            zoom: camera.zoom,
            width: pixelWidth,
            height: pixelHeight,
            hiddenId,
            pageId,
            background: CANVAS_BACKGROUND[useThemeStore.getState().resolved],
            fonts: useFontEvents.getState().version,
            layers: useLayerEvents.getState().version,
          };

          if (!sameKey(layerKey, key)) {
            layerImage?.delete();
            layerImage = null;
            layer ??= ck.MakeRenderTarget(context, pixelWidth, pixelHeight);
            if (layer) {
              paintDocument(layer, dpr, key, hiddenIds);
              layer.flush();
              layerImage = layer.makeImageSnapshot();
              layerKey = key;
            }
          }
          if (layerImage) canvas.drawImage(layerImage, 0, 0);
          else paintDocument(surface, dpr, key, hiddenIds);

          canvas.save();
          canvas.scale(dpr, dpr);
          const agent = useAgentStore.getState();
          const agentFocusIds = isRunActive(agent.status) ? agent.focusIds : undefined;
          const focusAnimated =
            agentFocusIds !== undefined && agentFocusIds.length > 0 && !prefersReducedMotion();
          const toolHandler = getToolHandler(useToolStore.getState().tool);
          renderOverlay(res, canvas, {
            doc,
            layout,
            camera,
            selection,
            hoveredId,
            marquee,
            dropLine,
            agentFocusIds,
            suppressSelection: toolHandler?.hidesSelection?.() ?? false,
            time: focusAnimated ? performance.now() : undefined,
          });
          toolHandler?.renderOverlay?.(res, canvas, camera);
          canvas.restore();
          surface.flush();
          // The agent focus box animates: keep frames coming only while it is on screen.
          if (focusAnimated) schedule();
        };

        const draw = () => {
          frame = 0;
          timeFrame(element.getContext("webgl2"), drawFrame);
        };
        function schedule() {
          if (!frame) frame = requestAnimationFrame(draw);
        }
        /** Draw now and drop any frame already queued for the same state. */
        const drawNow = () => {
          if (frame) cancelAnimationFrame(frame);
          draw();
        };

        /**
         * Rebuild the GL surface only when the pixel size really changed. Returns whether it did.
         * The caller draws straight after, in the same frame, so the bitmap never shows stale.
         */
        const syncSurface = (): boolean => {
          if (!grContext) return false;
          const dpr = window.devicePixelRatio || 1;
          const nextCssW = container.clientWidth;
          const nextCssH = container.clientHeight;
          const width = Math.max(Math.round(nextCssW * dpr), 1);
          const height = Math.max(Math.round(nextCssH * dpr), 1);
          const changed = !surface || width !== pixelWidth || height !== pixelHeight;
          if (changed) {
            dropLayer();
            surface?.delete();
            element.width = width;
            element.height = height;
            surface = ck.MakeOnScreenGLSurface(grContext, width, height, ck.ColorSpace.SRGB);
            pixelWidth = width;
            pixelHeight = height;
          }
          if (nextCssW !== cssWidth || nextCssH !== cssHeight) {
            cssWidth = nextCssW;
            cssHeight = nextCssH;
            const viewport = useViewportStore.getState();
            viewport.setSize(nextCssW, nextCssH);
            if (!viewport.fitted) {
              const { doc, pageId } = useDocumentStore.getState();
              viewport.zoomToFit(contentBounds(doc, getLayout(doc), pageId));
            }
          }
          return changed;
        };

        // ResizeObserver delivers at most once per frame, after layout and before paint, so
        // rebuilding and drawing right here is one rebuild per frame with no stale-bitmap flash.
        const onResize = () => {
          if (syncSurface()) drawNow();
        };

        syncSurface();
        drawNow();
        const observer = new ResizeObserver(onResize);
        observer.observe(container);
        const unsubscribers = [
          useDocumentStore.subscribe(schedule),
          useThemeStore.subscribe(schedule),
          useViewportStore.subscribe(schedule),
          useInteractionState.subscribe(schedule),
          useTextEditStore.subscribe(schedule),
          useFontEvents.subscribe(schedule),
          useLayerEvents.subscribe(schedule),
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
          dropLayer();
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
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(false);
        const rect = event.currentTarget.getBoundingClientRect();
        void dropFiles(
          Array.from(event.dataTransfer.files),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      {dropping ? (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/5">
          <span className="rounded-md bg-card px-3 py-1.5 text-xs text-foreground shadow-sm">
            Drop a .pego or .pen file to open it, or images to add them
          </span>
        </div>
      ) : null}
      <TextEditorOverlay />
      <AgentCursor />
      <Toolbar />
    </div>
  );
};
