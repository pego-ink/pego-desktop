import {
  applyOps as applyDocOps,
  collectDocIds,
  type Op,
  type PegoDocument,
  type Transaction,
} from "@pego/doc";
import type { PlanStep, RunAttachment, StepStatus, ToolHost } from "@pego/agent";
import { getLayout } from "@/canvas/layout";
import { listIconNames, loadIconData } from "@/canvas/icons";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { findAttachmentSrc } from "./attachments";
import { focusCamera } from "./focus-camera";
import { generateImage } from "./generate-image";
import { requestDecision } from "./decisions";
import { useAgentStore } from "./use-agent-store";

export type ToolHostOptions = {
  /** Undo-step label for fresh transactions. Defaults to the running step's title. */
  label?: () => string | undefined;
  /** Count new transactions in `transactionCount` (the run's "Undo all" range). */
  countTransactions?: boolean;
  /** Highlight the nodes an applied op touched (for callers whose tools do not set focus). */
  focusFromOps?: boolean;
  /** Called with the newest transaction after every apply. */
  onTransaction?: (transaction: Transaction) => void;
  /** Images the user attached to this run, served to `place_image` as "attachment:<id>". */
  attachments?: readonly RunAttachment[];
};

export type AgentToolHost = ToolHost & {
  /** Next `applyOps` starts a new undo transaction instead of extending the last one. */
  newGroup: () => void;
};

/** Render a node of `doc` to PNG on an offscreen surface (screenshots, any workspace). */
export const renderDocNodeImage = async (
  doc: PegoDocument,
  nodeId: string,
  imageOptions?: { scale?: number; maxSize?: number },
) => {
  // Loaded on demand: CanvasKit (and its wasm) only matter once a screenshot is requested.
  const [{ loadCanvasKit }, { renderNodeImage }, { collectFontFaces }, { ensureFontFace }] =
    await Promise.all([
      import("@/canvas/load-canvaskit"),
      import("@/canvas/render-image"),
      import("@/fonts/use-document-fonts"),
      import("@/fonts/font-service"),
    ]);
  const res = await loadCanvasKit();
  // The document's fonts first, so the agent judges the real typography.
  await Promise.all(collectFontFaces(doc).map(ensureFontFace));
  return renderNodeImage(res, doc, getLayout(doc), nodeId, imageOptions);
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
export const createToolHost = (options: ToolHostOptions = {}): AgentToolHost => {
  const { countTransactions = true } = options;
  let lastSeen: Transaction | null = null;
  let currentStepId: string | null = null;

  const currentLabel = () => {
    const custom = options.label?.();
    if (custom) return custom;
    const step = useAgentStore.getState().steps.find((s) => s.id === currentStepId);
    return step?.title ?? "Agent";
  };

  const applyOps = (ops: Op[]) => {
    if (ops.length === 0) return;
    const documentStore = useDocumentStore.getState();
    // Dry run on the pure op engine so an invalid op surfaces as its own OpError (the store's
    // commit swallows and toasts it) and leaves the document and history untouched.
    applyDocOps(documentStore.doc, ops);

    const extend = lastSeen !== null && documentStore.history.past.at(-1) === lastSeen;
    const ok = extend
      ? documentStore.extendLast(ops)
      : documentStore.commit(ops, { label: currentLabel(), source: "agent" });
    if (!ok) throw new Error("the document rejected the edit");

    lastSeen = useDocumentStore.getState().history.past.at(-1) ?? null;
    if (!extend && countTransactions) {
      const agent = useAgentStore.getState();
      agent.set({ transactionCount: agent.transactionCount + 1 });
    }
    if (lastSeen) options.onTransaction?.(lastSeen);
    if (options.focusFromOps) useAgentStore.getState().set({ focusIds: touchedIds(ops) });
  };

  const reportPlan = (steps: PlanStep[]) => {
    const agent = useAgentStore.getState();
    agent.setPlan(steps);
    if (agent.status === "planning") agent.set({ status: "running" });
  };

  const reportStep = (stepId: string, status: StepStatus, summary?: string) => {
    const agent = useAgentStore.getState();
    agent.setStepStatus(stepId, status, summary);
    if (status === "running") {
      currentStepId = stepId;
      if (agent.status === "planning") agent.set({ status: "running" });
    }
    // Every step boundary closes the current undo transaction.
    lastSeen = null;
  };

  // The icon list is read synchronously; make sure the (lazy) lucide data is on its way.
  void loadIconData().catch(() => {});

  const setSelection = (ids: string[]) => {
    const known = collectDocIds(useDocumentStore.getState().doc);
    useDocumentStore.getState().select([...new Set(ids)].filter((id) => known.has(id)));
  };

  const focusViewport = (ids: string[]) => {
    const layout = getLayout(useDocumentStore.getState().doc);
    const boxes = ids.flatMap((id) => layout.get(id) ?? []);
    const viewport = useViewportStore.getState();
    const camera = focusCamera(boxes, viewport.size);
    if (camera) viewport.animateTo(camera);
  };

  const renderImage: NonNullable<ToolHost["renderImage"]> = (nodeId, imageOptions) =>
    renderDocNodeImage(useDocumentStore.getState().doc, nodeId, imageOptions);

  return {
    getDoc: () => useDocumentStore.getState().doc,
    getLayout: () => getLayout(useDocumentStore.getState().doc),
    getSelection: () => useDocumentStore.getState().selection,
    setSelection,
    focusViewport,
    listIcons: listIconNames,
    renderImage,
    generateImage,
    getAttachment: (id) => findAttachmentSrc(options.attachments ?? [], id),
    applyOps,
    setFocus: (ids) => useAgentStore.getState().set({ focusIds: ids }),
    reportPlan,
    reportStep,
    askUser: requestDecision,
    newGroup: () => {
      lastSeen = null;
    },
  };
};
