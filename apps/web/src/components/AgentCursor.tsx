import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { EASE_OUT, prefersReducedMotion } from "@pego/ui/lib/motion";
import type { Layout, PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import {
  clampToSize,
  createGlide,
  driftOffset,
  glideAt,
  isCursorActive,
  nextInspectDelay,
  pickInspectAnchor,
  pickParkPoint,
  pickTargetAnchor,
  pickWanderPoint,
  pointInRect,
  unionRect,
  type Fraction,
  type Glide,
  type Point,
  type Rect,
} from "@/canvas/agent-cursor-motion";
import { docToScreen, screenToDoc } from "@/canvas/types";
import { runColor, RUN_INK } from "@/agent/run-colors";
import { useAgentStore } from "@/agent/use-agent-store";
import { idsOnPage } from "@/agent/focus-groups";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

const PILL_FLIP_MARGIN = 190;

/** Focus ids on the shown page: a run working on another page makes the cursor wander here. */
const shownFocusIds = (ids: readonly string[]): readonly string[] =>
  idsOnPage(activePage(useDocumentStore.getState()), ids);

type Mode = "target" | "wander" | "park";
type Aim = { kind: "box"; anchor: Fraction } | { kind: "point"; point: Point };

type Session = {
  key: string;
  mode: Mode;
  aim: Aim;
  glide: Glide;
  position: Point;
  step: number;
  nextInspectAt: number;
};

const PILL_FLIP_TRANSITION = `transform 120ms ${EASE_OUT}`;

type FocusInfo = {
  doc: PegoDocument;
  ids: readonly string[];
  /** Focused ids that exist in the layout, joined for the session key. */
  targets: string[];
  key: string;
  union: Rect | null;
};

/** Focus targets and their union box, recomputed only when the document or focus ids change. */
const createFocusMemo = () => {
  let memo: FocusInfo | null = null;
  return (doc: PegoDocument, ids: readonly string[], layout: () => Layout): FocusInfo => {
    if (memo && memo.doc === doc && memo.ids === ids) return memo;
    const map = layout();
    const targets = ids.filter((id) => map.has(id));
    const boxes = targets.flatMap((id) => {
      const box = map.get(id);
      return box ? [box] : [];
    });
    memo = { doc, ids, targets, key: targets.join(","), union: unionRect(boxes) };
    return memo;
  };
};

const pillText = (mode: Mode, runLabel: string | null) =>
  mode === "park" ? "Waiting for you" : runLabel ? `Pego · ${runLabel}` : "Pego";

/**
 * Multiplayer-style cursor that shows where one session's agent is working, tinted with that
 * session's run color. Pure DOM overlay: one rAF loop writes transforms from refs, React never
 * re-renders per frame.
 */
const AgentCursor = ({ sessionId }: { sessionId: string }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const arrow = arrowRef.current;
    const pill = pillRef.current;
    const ring = ringRef.current;
    if (!root || !arrow || !pill || !ring) return;

    let frame = 0;
    let session: Session | null = null;
    let shownText = "";
    let flipped = false;
    let visible = false;
    let shownColor = "";
    const focusInfo = createFocusMemo();
    const live = () => useAgentStore.getState().liveSessions[sessionId];

    const resolveAim = (current: Session, size: { width: number; height: number }) => {
      const { camera } = useViewportStore.getState();
      const { doc } = useDocumentStore.getState();
      if (current.mode === "target" && current.aim.kind === "box") {
        const { union } = focusInfo(doc, shownFocusIds(live()?.focusIds ?? []), () =>
          getLayout(doc),
        );
        if (union) {
          const raw = pointInRect(union, current.aim.anchor);
          const screen = clampToSize(docToScreen(camera, raw.x, raw.y), size);
          return screenToDoc(camera, screen.x, screen.y);
        }
      }
      return current.aim.kind === "point" ? current.aim.point : current.position;
    };

    const chooseAim = (mode: Mode, key: string, step: number, inspect: boolean): Aim => {
      const { camera, size } = useViewportStore.getState();
      if (mode === "target")
        return {
          kind: "box",
          anchor: inspect ? pickInspectAnchor(key, step) : pickTargetAnchor(key),
        };
      const screen = mode === "park" ? pickParkPoint(size, step) : pickWanderPoint(size, step);
      return { kind: "point", point: screenToDoc(camera, screen.x, screen.y) };
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const hide = () => {
      visible = false;
      root.style.opacity = "0";
      session = null;
      stop();
    };

    const tick = () => {
      frame = 0;
      const now = performance.now();
      const agent = live();
      if (!agent) return hide();
      const lastLogAt = agent.log.at(-1)?.at ?? null;
      if (!isCursorActive(agent.status, lastLogAt, Date.now())) return hide();
      const color = runColor(agent.colorIndex);
      if (color !== shownColor) {
        shownColor = color;
        root.style.color = color;
        pill.style.background = color;
      }

      const { camera, size } = useViewportStore.getState();
      if (size.width === 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const reduced = prefersReducedMotion();

      const doc = useDocumentStore.getState().doc;
      const focus = focusInfo(doc, shownFocusIds(agent.focusIds), () => getLayout(doc));
      const mode: Mode =
        agent.status === "awaiting_decision"
          ? "park"
          : focus.targets.length > 0
            ? "target"
            : "wander";
      const key = `${mode}:${focus.key}`;

      if (!session) {
        const start = screenToDoc(camera, size.width * 0.5, size.height * 0.18);
        session = {
          key: "",
          mode,
          aim: { kind: "point", point: start },
          glide: createGlide(start, start, now, camera.zoom, 0),
          position: start,
          step: 0,
          nextInspectAt: now,
        };
      }
      const current = session;

      const retarget = (inspect: boolean) => {
        const seedKey = inspect ? current.key : key;
        if (!inspect) current.step = 0;
        else current.step += 1;
        const from = current.position;
        current.mode = mode;
        current.aim = chooseAim(mode, seedKey, current.step, inspect);
        const to = resolveAim(current, size);
        current.glide = createGlide(
          from,
          to,
          now,
          camera.zoom,
          current.step + seedKey.length,
          inspect ? 0.55 : 1,
        );
        current.key = key;
        current.nextInspectAt =
          now + (mode === "park" ? 1e9 : nextInspectDelay(seedKey, current.step));
      };

      if (current.key !== key) retarget(false);
      else if (now >= current.nextInspectAt) retarget(true);

      const to = resolveAim(current, size);
      const point = reduced ? to : glideAt(current.glide, to, now).point;
      current.position = point;

      const screen = docToScreen(camera, point.x, point.y);
      const drift = reduced ? { x: 0, y: 0 } : driftOffset(now, current.key.length + 3);
      const x = screen.x + drift.x;
      const y = screen.y + drift.y;
      root.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;

      const text = pillText(mode, agent.runLabel);
      if (text !== shownText) {
        shownText = text;
        pill.textContent = text;
      }
      const shouldFlip = x > size.width - PILL_FLIP_MARGIN;
      if (shouldFlip !== flipped) {
        flipped = shouldFlip;
        pill.style.transition = reduced ? "none" : PILL_FLIP_TRANSITION;
        // Flip to the left of the arrow with a transform so it can transition (left/right cannot).
        pill.style.transform = shouldFlip ? "translateX(calc(-100% - 4px))" : "translateX(0)";
      }
      if (!visible) {
        visible = true;
        root.style.opacity = "1";
      }
      frame = requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const playClick = () => {
      if (!visible || prefersReducedMotion()) return;
      arrow.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(0.84)", offset: 0.35 },
          { transform: "scale(1)" },
        ],
        { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
      ring.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0.65 },
          { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 },
        ],
        { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    };

    const unsubscribeAgent = useAgentStore.subscribe((state, prev) => {
      const now = state.liveSessions[sessionId];
      const before = prev.liveSessions[sessionId];
      if (now?.status !== before?.status || now?.log !== before?.log) ensureLoop();
    });
    const unsubscribeDoc = useDocumentStore.subscribe((state, prev) => {
      const past = state.history.past;
      const last = past.at(-1);
      if (!last || last === prev.history.past.at(-1)) return;
      if (past.length < prev.history.past.length) return;
      if (last.source !== "agent") return;
      // Click only on this session's own edits; run-less edits (Claude Code over MCP) belong to
      // the session in the panel.
      const own = last.runId
        ? last.runId === live()?.runId
        : useAgentStore.getState().visibleSessionId === sessionId;
      if (own) playClick();
    });
    ensureLoop();

    return () => {
      unsubscribeAgent();
      unsubscribeDoc();
      stop();
    };
  }, [sessionId]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 will-change-transform"
      style={{
        opacity: 0,
        color: runColor(0),
        transition: "opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <div
        ref={ringRef}
        className="absolute top-0 left-0 size-8 rounded-full opacity-0"
        style={{ border: "2px solid currentColor", transform: "translate(-50%, -50%) scale(0.3)" }}
      />
      <div
        ref={arrowRef}
        className="absolute top-0 left-0 will-change-transform"
        style={{
          transformOrigin: "0 0",
          filter:
            "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35)) drop-shadow(0 4px 10px rgb(0 0 0 / 0.2))",
        }}
      >
        <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
          <path
            d="M1.5 1.2 L1.5 16.4 L5.6 12.7 L8.3 19.1 L11.1 17.9 L8.4 11.6 L14 11.6 Z"
            fill="currentColor"
            stroke="#fff"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div
        ref={pillRef}
        className="absolute top-[18px] left-[14px] rounded-full px-2 py-[3px] text-[11px] leading-4 font-medium whitespace-nowrap"
        style={{
          background: runColor(0),
          color: RUN_INK,
          boxShadow: "0 0 0 1px rgb(255 255 255 / 0.35), 0 2px 8px rgb(0 0 0 / 0.3)",
        }}
      >
        Pego
      </div>
    </div>
  );
};

/** One cursor per session in memory; each shows only while its agent is working. */
export const AgentCursors = () => {
  const sessionIds = useAgentStore(useShallow((state) => Object.keys(state.liveSessions)));
  return sessionIds.map((id) => <AgentCursor key={id} sessionId={id} />);
};
