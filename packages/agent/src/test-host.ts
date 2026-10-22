import { applyOps, sampleDoc, type Op, type PegoDocument } from "@pego/doc";
import type { DecisionRequest, PlanStep, StepStatus, ToolHost } from "./types";

export type FakeHost = ToolHost & {
  doc: () => PegoDocument;
  calls: { applyOps: Op[][]; focus: string[][]; plans: PlanStep[][]; steps: unknown[][] };
  asked: DecisionRequest[];
};

/** In-memory ToolHost over a real document, for tests. */
export const createFakeHost = (
  initial: PegoDocument = sampleDoc,
  answer = (request: DecisionRequest) => request.options[0] ?? "",
): FakeHost => {
  let doc = initial;
  const calls: FakeHost["calls"] = { applyOps: [], focus: [], plans: [], steps: [] };
  const asked: DecisionRequest[] = [];
  return {
    doc: () => doc,
    calls,
    asked,
    getDoc: () => doc,
    applyOps: (ops) => {
      doc = applyOps(doc, ops).doc;
      calls.applyOps.push(ops);
    },
    setFocus: (ids) => void calls.focus.push(ids),
    reportPlan: (steps) => void calls.plans.push(steps),
    reportStep: (stepId: string, status: StepStatus, summary?: string) =>
      void calls.steps.push([stepId, status, summary]),
    askUser: async (request) => {
      asked.push(request);
      return answer(request);
    },
  };
};
