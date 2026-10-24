import { applyOps as applyDocOps, collectDocIds, type Op, type Transaction } from "@pego/doc";
import {
  ToolError,
  type PlanStep,
  type RunAttachment,
  type StepStatus,
  type ToolHost,
} from "@pego/agent";
import { getLayout } from "@/canvas/layout";
import { listIconNames, loadIconData } from "@/canvas/icons";
import {
  activePage,
  useDocumentStore,
  type CommitMeta,
  type DocumentCore,
} from "@/store/use-document-store";
import { showPage, showPageOf } from "@/pages/page-actions";
import { useViewportStore, visibleRect } from "@/store/use-viewport-store";
import {
  commitToTarget,
  extendTarget,
  isTargetVisible,
  readTarget,
  type DocumentTarget,
} from "@/workspace/document-target";
import { sharedBrowserHost } from "@/browser/browser-host";
import { resolveFont } from "@/fonts/resolve-font";
import { findAttachmentSrc } from "./attachments";
import { focusCamera } from "./focus-camera";
import { generateImage } from "./generate-image";
import { searchOpenverse } from "@/images/openverse";
import { requestDecision } from "./decisions";
import { runClaims } from "./run-claims";
import { getRun } from "./run-registry";
import { liveTitle, runScope, useAgentStore, type RunScope } from "./use-agent-store";

export type ToolHostOptions = {
  /**
   * The run this host edits for: its transactions carry the id (selective "Undo all"), its
   * edits claim nodes, and plan/steps/focus land in that run's session. Omitted = no run (Claude
   * Code over MCP, tests): state goes to the visible session and nothing is claimed.
   */
  runId?: string;
  /** Undo-step label for fresh transactions. Defaults to the running step's title. */
  label?: () => string | undefined;
  /** Count new transactions in the session's `transactionCount` ("N changes"). */
  countTransactions?: boolean;
  /** Highlight the nodes an applied op touched (for callers whose tools do not set focus). */
  focusFromOps?: boolean;
  /** Images the user attached to this run, served to `place_image` as "attachment:<id>". */
  attachments?: readonly RunAttachment[];
  /**
   * The document this host edits (the run's tab), shown or in the background. Omitted = whatever
   * the editor shows at each call (Claude Code over MCP, tests).
   */
  target?: DocumentTarget;
};

export type AgentToolHost = ToolHost & {
  /** Next `applyOps` starts a new undo transaction instead of extending the last one. */
  newGroup: () => void;
  /** Where this host's run writes its live state (the runtimes log and report through it). */
  run: RunScope;
  /** The document this host edits; undefined = the one shown in the editor. */
  target?: DocumentTarget;
};

/** Title of the chat a run belongs to, for messages that name another run. */
const runSessionTitle = (runId: string): string => {
  const sessionId = getRun(runId)?.sessionId;
  const live = sessionId ? useAgentStore.getState().liveSessions[sessionId] : undefined;
  return live ? liveTitle(live) : "another chat";
};

/** Refuse ops that would modify nodes another active run claimed (see run-claims). */
const assertUnclaimed = (doc: DocumentCore["doc"], ops: Op[], runId: string) => {
  const hit = runClaims.conflict(doc, ops, runId, (owner) => getRun(owner) !== undefined);
  if (!hit) return;
  throw new ToolError(
    "node_claimed",
    `Node "${hit.nodeId}" is being edited by the agent in the chat "${runSessionTitle(hit.runId)}".`,
    "Leave it and the layers inside it alone until that run ends: pick another target, or create new layers elsewhere.",
  );
};

const touchedIds = (ops: Op[]): string[] =>
  ops.flatMap((op) => {
    if (op.op === "insert") return [op.node.id];
    if (op.op === "update" || op.op === "replace" || op.op === "move") return [op.id];
    return [];
  });

/**
 * A `ToolHost` over the document and agent stores. All ops of one agent step land in ONE undo
 * transaction: the first `applyOps` commits, later ones extend it, but only while the newest
 * history entry is still the one this host wrote (a user edit in between starts a new one).
 */
const documentClosed = () =>
  new ToolError(
    "document_closed",
    "The document this run was editing has been closed.",
    "Stop here and tell the user: the run cannot continue without its document.",
  );

export const createToolHost = (options: ToolHostOptions = {}): AgentToolHost => {
  const { countTransactions = true, runId, target } = options;

  /** The state of the document this host edits (the shown one without a target). */
  const state = (): DocumentCore => {
    if (!target) return useDocumentStore.getState();
    const core = readTarget(target);
    if (!core) throw documentClosed();
    return core;
  };
  /** The host's document is the one in the editor (canvas, selection and camera are its). */
  const shown = () => !target || isTargetVisible(target);
  const commit = (ops: Op[], meta: CommitMeta) =>
    target ? commitToTarget(target, ops, meta) : useDocumentStore.getState().commit(ops, meta);
  const extend = (ops: Op[]) =>
    target ? extendTarget(target, ops) : useDocumentStore.getState().extendLast(ops);
  const run = runScope(runId ?? null);
  let lastSeen: Transaction | null = null;
  let currentStepId: string | null = null;

  const currentLabel = () => {
    const custom = options.label?.();
    if (custom) return custom;
    const step = run.get()?.steps.find((s) => s.id === currentStepId);
    return step?.title ?? "Agent";
  };

  const applyOps = (ops: Op[]) => {
    if (ops.length === 0) return;
    const current = state();
    const before = current.doc;
    // Another run's nodes are off limits; nothing is applied when one is hit.
    if (runId) assertUnclaimed(before, ops, runId);
    // Dry run on the pure op engine so an invalid op surfaces as its own OpError (the store's
    // commit swallows and toasts it) and leaves the document and history untouched.
    applyDocOps(before, ops);

    const extending = lastSeen !== null && current.history.past.at(-1) === lastSeen;
    const ok = extending
      ? extend(ops)
      : commit(ops, {
          label: currentLabel(),
          source: "agent",
          ...(runId ? { runId } : {}),
        });
    if (!ok) throw new Error("the document rejected the edit");
    if (runId) runClaims.claim(before, ops, runId);

    lastSeen = state().history.past.at(-1) ?? null;
    if (!extending && countTransactions) {
      run.set({ transactionCount: (run.get()?.transactionCount ?? 0) + 1 });
    }
    if (options.focusFromOps) run.set({ focusIds: touchedIds(ops) });
  };

  const reportPlan = (steps: PlanStep[]) => {
    run.setPlan(steps);
    if (run.get()?.status === "planning") run.set({ status: "running" });
  };

  const reportStep = (stepId: string, status: StepStatus, summary?: string) => {
    run.setStepStatus(stepId, status, summary);
    if (status === "running") {
      currentStepId = stepId;
      if (run.get()?.status === "planning") run.set({ status: "running" });
    }
    // Every step boundary closes the current undo transaction.
    lastSeen = null;
  };

  // The icon list is read synchronously; make sure the (lazy) lucide data is on its way.
  void loadIconData().catch(() => {});

  /**
   * Only the run of the chat in the panel may move the user's selection or camera; a background
   * run must not pull the user away from what they are doing (its focus box still shows).
   */
  const inView = () => shown() && run.sessionId() === useAgentStore.getState().visibleSessionId;

  const setSelection = (ids: string[]) => {
    if (!inView()) return;
    const known = collectDocIds(state().doc);
    useDocumentStore.getState().select([...new Set(ids)].filter((id) => known.has(id)));
  };

  const focusViewport = (ids: string[]) => {
    if (!inView()) return;
    // Nodes on another page: show that page first.
    if (ids[0] !== undefined) showPageOf(ids[0]);
    const layout = getLayout(useDocumentStore.getState().doc);
    const boxes = ids.flatMap((id) => layout.get(id) ?? []);
    const viewport = useViewportStore.getState();
    const camera = focusCamera(boxes, visibleRect(viewport));
    if (camera) viewport.animateTo(camera);
  };

  /**
   * The page this host's agent chose with a page tool. Pinned so the agent keeps working there
   * even when the user switches pages, and so a background run can work on a page without
   * showing it. Null = follow the page shown in the editor.
   */
  let pinnedPageId: string | null = null;
  const getActivePageId = (): string => {
    const current = state();
    const pinned = pinnedPageId;
    if (pinned !== null && current.doc.children.some((page) => page.id === pinned)) return pinned;
    return activePage(current).id;
  };
  const setActivePage = (pageId: string) => {
    pinnedPageId = pageId;
    if (inView()) showPage(pageId);
  };

  const renderImage: NonNullable<ToolHost["renderImage"]> = async (nodeId, imageOptions) => {
    // Loaded on demand: CanvasKit (and its wasm) only matter once a screenshot is requested.
    const [{ loadCanvasKit }, { renderNodeImage }] = await Promise.all([
      import("@/canvas/load-canvaskit"),
      import("@/canvas/render-image"),
    ]);
    const [res, { loadDocumentFonts }] = await Promise.all([
      loadCanvasKit(),
      import("@/fonts/use-document-fonts"),
    ]);
    // Wait for the document's fonts so the agent judges the real typography.
    await loadDocumentFonts(state().doc);
    const { doc } = state();
    return renderNodeImage(res, doc, getLayout(doc), nodeId, imageOptions);
  };

  const browser = sharedBrowserHost();

  return {
    getDoc: () => state().doc,
    getLayout: () => getLayout(state().doc),
    getActivePageId,
    setActivePage,
    getSelection: () => state().selection,
    setSelection,
    focusViewport,
    listIcons: listIconNames,
    renderImage,
    generateImage,
    searchImages: (request) => searchOpenverse(request),
    // Loaded on first use: the image helpers import stores that import this module.
    fetchImage: async (url) => (await import("@/images/image-from-url")).imageUrlAsDataUrl(url),
    resolveFont,
    getAttachment: (id) => findAttachmentSrc(options.attachments ?? [], id),
    applyOps,
    setFocus: (ids) => run.set({ focusIds: ids }),
    reportPlan,
    reportStep,
    askUser: (request) => requestDecision(run, request),
    newGroup: () => {
      lastSeen = null;
    },
    run,
    ...(target ? { target } : {}),
    ...(browser ? { browser } : {}),
  };
};
