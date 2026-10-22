import Anthropic from "@anthropic-ai/sdk";
import {
  agentTools,
  EXECUTOR_SYSTEM,
  parsePlan,
  PLANNER_SYSTEM,
  planOutputSchema,
  toolByName,
  type PlanStep,
  type ToolResult,
  type ToolSpec,
} from "@pego/agent";
import { AgentRunError, describeApiError, isAbortError } from "./api-errors";
import { RunCancelledError } from "./decisions";
import type { AgentToolHost } from "./tool-host";
import { toUsageDelta } from "./usage";
import { resolveRunSkills, skillLogLines, skillsBlock } from "./run-skills";
import { useAgentStore } from "./use-agent-store";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const PLANNER_MODEL = "claude-opus-5-5";
export const EXECUTOR_MODEL = "claude-sonnet-5-5";

/**
 * Refusal fallbacks are enabled by default on every call: `fallbacks: "default"` lets the API
 * re-run a request that Opus 5.5 / Sonnet 5.5 safety classifiers decline on the model Anthropic
 * recommends for that category, inside the same call. The "default" form needs this beta header
 * (the older array form uses `server-side-fallback-2026-06-01`; mixing them is a 400).
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Effort. Opus 5.5 defaults to `medium` and cannot disable thinking, so planning sets `high`
 * explicitly (one call that shapes the whole run). Sonnet 5.5 defaults to `high`; the skill's
 * guidance for multistep tool use is to start at `medium`, which also keeps step latency and
 * cost down. `thinking` is omitted on both: adaptive thinking is the default and the only mode.
 */
const PLANNER_EFFORT = "high" as const;
const EXECUTOR_EFFORT = "medium" as const;

/** Streaming, so large `max_tokens` is safe from HTTP timeouts. Thinking counts toward it. */
const PLANNER_MAX_TOKENS = 32_000;
const EXECUTOR_MAX_TOKENS = 64_000;
/** Bound on model turns per step (unbounded-consumption guard). */
const MAX_TURNS_PER_STEP = 40;
const MAX_TOOL_RESULT_CHARS = 100_000;

/** The slice of the SDK the runtime uses, so tests can inject a fake. */
export type MessagesClient = {
  beta: {
    messages: {
      stream: (
        body: StreamParams,
        options?: { signal?: AbortSignal },
      ) => { finalMessage: () => Promise<BetaMessage> };
    };
  };
};

export const createAnthropicClient = (apiKey: string): MessagesClient =>
  // The key is the user's own (BYOK) and the app has no backend to hold it, hence the opt-in.
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

/**
 * A user-added Anthropic-compatible endpoint (a gateway or proxy that speaks `/v1/messages`).
 * `compat` drops the features such gateways rarely implement; the official API path (no provider)
 * is untouched.
 */
export type ApiProviderConfig = {
  baseUrl: string;
  apiKey: string;
  plannerModel: string;
  executorModel: string;
  compat: boolean;
  /** Display name for log lines and errors; falls back to the base URL host. */
  name?: string;
};

/** Output caps for compat providers: many backends reject the official API's larger values. */
const COMPAT_MAX_TOKENS = 16_000;

/** The slice of the plain (non-beta) SDK the compat client uses, so tests can inject a fake. */
export type CompatSdk = {
  messages: {
    stream: (
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ) => { finalMessage: () => Promise<Anthropic.Message> };
    create: (
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ) => Promise<Anthropic.Message>;
  };
};

/** HTTP statuses that mean "this endpoint does not do that" rather than "your key/quota is bad". */
const UNSUPPORTED_STATUSES = new Set([400, 404, 405, 415, 422, 501]);

/**
 * Streaming failed in a way that a non-streaming call might survive: the gateway rejected or
 * does not implement SSE (those statuses), or answered with something the SDK's stream parser
 * could not read. Auth, quota and network errors are not retried.
 */
export const shouldRetryNonStreaming = (error: unknown): boolean => {
  if (isAbortError(error)) return false;
  if (error instanceof Anthropic.APIError) {
    return error.status !== undefined && UNSUPPORTED_STATUSES.has(error.status);
  }
  return error instanceof Anthropic.AnthropicError;
};

/**
 * Client for an Anthropic-compatible provider. Uses the plain `/v1/messages` endpoint (not the
 * beta namespace, which adds `?beta=true` and beta headers) and falls back to a non-streaming
 * call once if the gateway cannot stream; later calls then skip streaming.
 */
export const createCompatClient = (
  config: Pick<ApiProviderConfig, "baseUrl" | "apiKey">,
  sdk: CompatSdk = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    // BYOK like the official path: the user's key goes only to the base URL they entered.
    dangerouslyAllowBrowser: true,
  }),
): MessagesClient => {
  let streaming = true;
  return {
    beta: {
      messages: {
        stream: (body, options) => ({
          finalMessage: async () => {
            const params = body as unknown as Anthropic.MessageCreateParamsNonStreaming;
            if (streaming) {
              try {
                return (await sdk.messages
                  .stream(params, options)
                  .finalMessage()) as unknown as BetaMessage;
              } catch (error) {
                if (!shouldRetryNonStreaming(error)) throw error;
                streaming = false;
              }
            }
            return (await sdk.messages.create(params, options)) as unknown as BetaMessage;
          },
        }),
      },
    },
  };
};

type RuntimeContext = {
  client: MessagesClient;
  /** Custom Anthropic-compatible provider; undefined = the official Anthropic API. */
  provider?: ApiProviderConfig;
  host: AgentToolHost;
  signal: AbortSignal;
  /** Skill text for the user turns (set by `runApiAgent`). */
  skillsText?: string;
  /** Explicit skill for this run: undefined = auto-detect, null = core only. */
  skillId?: string | null;
};

const agent = () => useAgentStore.getState();

const cancelIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new RunCancelledError();
};

const plannerModel = (ctx: RuntimeContext) => ctx.provider?.plannerModel ?? PLANNER_MODEL;
const executorModel = (ctx: RuntimeContext) => ctx.provider?.executorModel ?? EXECUTOR_MODEL;
const isCompat = (ctx: RuntimeContext) => ctx.provider?.compat === true;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const providerLabel = (provider: ApiProviderConfig) =>
  provider.name?.trim() || hostOf(provider.baseUrl);

/** Like `describeApiError`, but names the provider instead of Anthropic. */
export const describeCompatError = (error: unknown, provider: ApiProviderConfig): string => {
  const label = providerLabel(provider);
  if (error instanceof Anthropic.AuthenticationError) {
    return `${label} rejected the API key. Check it in Model settings.`;
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `${label} did not allow this key to use the requested model.`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `${label} returned 404. Check the base URL and the model ids in Model settings.`;
  }
  if (error instanceof Anthropic.RateLimitError)
    return `Rate limited by ${label}. Try again shortly.`;
  if (error instanceof Anthropic.BadRequestError) {
    return `${label} rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.InternalServerError)
    return `${label} is unavailable. Try again shortly.`;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return `The request to ${label} timed out. Try again.`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return `Could not reach ${hostOf(provider.baseUrl)}. Check the base URL and your connection. The server must also allow browser (CORS) requests.`;
  }
  if (error instanceof Anthropic.APIError) {
    return `${label} error ${error.status ?? ""}: ${error.message}`.replace("  ", " ");
  }
  return describeApiError(error);
};

const recordUsage = (message: BetaMessage, requestedModel: string) =>
  agent().addUsage(toUsageDelta(message.usage, message.model, requestedModel));

const textOf = (message: BetaMessage): string =>
  message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

/** Stop reasons that mean "no usable result" for a call without a tool loop. */
const assertCompleted = (message: BetaMessage, what: string) => {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    throw new AgentRunError(
      `The model declined the ${what}${category ? ` (${category})` : ""}. Rephrase the request.`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new AgentRunError(`The ${what} was cut off (max_tokens).`);
  }
};

// ---- planner -------------------------------------------------------------------------------

/** JSON for the planner from a text reply: bare, fenced, or surrounded by prose. */
export const extractJson = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
    return JSON.parse(fenced.slice(start, end + 1));
  }
};

/** Compat planner: no structured output, so the schema goes into the prompt and the JSON comes back as text. */
const COMPAT_PLAN_FORMAT = `\n\nReply with ONLY one JSON object that matches this JSON Schema. No markdown fences, no commentary.\n${JSON.stringify(planOutputSchema)}`;

/** Planner request body. Exported for tests. */
export const plannerRequest = (ctx: RuntimeContext, prompt: string): StreamParams => {
  const documentJson = JSON.stringify(ctx.host.getDoc());
  // Volatile content (document, request) goes in the user turn; the system prompt stays
  // byte-identical across runs.
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: [
        ctx.skillsText,
        `Current document (JSON):\n${documentJson}\n\nUser request:\n${prompt}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  if (isCompat(ctx)) {
    return {
      model: plannerModel(ctx),
      max_tokens: COMPAT_MAX_TOKENS,
      system: PLANNER_SYSTEM + COMPAT_PLAN_FORMAT,
      messages,
    };
  }
  return {
    model: plannerModel(ctx),
    max_tokens: PLANNER_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: {
      effort: PLANNER_EFFORT,
      format: { type: "json_schema", schema: planOutputSchema },
    },
    system: PLANNER_SYSTEM,
    messages,
  };
};

const requestPlan = async (ctx: RuntimeContext, prompt: string): Promise<PlanStep[]> => {
  const model = plannerModel(ctx);
  const message = await ctx.client.beta.messages
    .stream(plannerRequest(ctx, prompt), { signal: ctx.signal })
    .finalMessage();
  recordUsage(message, model);
  assertCompleted(message, "plan");
  try {
    const text = textOf(message);
    return parsePlan(isCompat(ctx) ? extractJson(text) : JSON.parse(text));
  } catch {
    throw new AgentRunError("The planner returned a plan that could not be read. Try again.");
  }
};

// ---- executor ------------------------------------------------------------------------------

const baseTools: Anthropic.Beta.BetaTool[] = agentTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
}));

// Streamed tool input is not validated by the API; see `checkToolInput` and `runToolUse`.
const executorTools: Anthropic.Beta.BetaTool[] = baseTools.map((tool) => ({
  ...tool,
  eager_input_streaming: true,
}));

/** Executor request body. Exported for tests. */
export const executorRequest = (ctx: RuntimeContext, messages: BetaMessageParam[]): StreamParams =>
  isCompat(ctx)
    ? {
        // Plain request: no fallbacks/beta header, no effort, no eager input streaming, no
        // top-level cache_control. The system-block breakpoint is a long-standing field.
        model: executorModel(ctx),
        max_tokens: COMPAT_MAX_TOKENS,
        system: [{ type: "text", text: EXECUTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: baseTools,
        messages,
      }
    : {
        model: executorModel(ctx),
        max_tokens: EXECUTOR_MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: EXECUTOR_EFFORT },
        // Render order is tools -> system -> messages: the breakpoint on the system block caches
        // the stable tools + system prefix across steps and runs; the top-level marker moves
        // forward with the conversation so each loop turn reads the previous turn from cache.
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: EXECUTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: executorTools,
        messages,
      };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Cheap structural check before `tool.run` (which does the full validation): eager input
 * streaming can hand back a silently truncated object, so reject non-objects and missing
 * required keys here.
 */
export const checkToolInput = (spec: ToolSpec, input: unknown): string | null => {
  if (!isRecord(input)) return "tool input must be a JSON object";
  const required = spec.inputSchema.required;
  if (!Array.isArray(required)) return null;
  const missing = required.filter((key) => typeof key === "string" && !(key in input));
  return missing.length > 0 ? `missing required fields: ${missing.join(", ")}` : null;
};

const truncate = (text: string) =>
  text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated ${text.length - MAX_TOOL_RESULT_CHARS} characters]`
    : text;

/**
 * `tool_result` for a finished tool. Images (screenshots) go first as base64 image blocks,
 * followed by the text block; a result without images keeps the plain string content.
 */
export const toToolResultBlock = (
  toolUseId: string,
  result: ToolResult,
): Anthropic.Beta.BetaToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: toolUseId,
  content:
    result.images && result.images.length > 0
      ? [
          ...result.images.map((image) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
          })),
          { type: "text" as const, text: truncate(result.content) },
        ]
      : truncate(result.content),
  ...(result.isError ? { is_error: true } : {}),
});

const runToolUse = async (
  block: Anthropic.Beta.BetaToolUseBlock,
  host: AgentToolHost,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
  const fail = (content: string): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    is_error: true,
    content,
  });
  const spec = toolByName(block.name);
  if (!spec) return fail(`Unknown tool: ${block.name}`);
  const invalid = checkToolInput(spec, block.input);
  if (invalid) {
    return fail(JSON.stringify({ INVALID_JSON: JSON.stringify(block.input), error: invalid }));
  }
  try {
    const result = await spec.run(block.input, host);
    return toToolResultBlock(block.id, result);
  } catch (error) {
    if (error instanceof RunCancelledError) throw error;
    return fail(error instanceof Error ? error.message : "tool failed");
  }
};

const planText = (steps: PlanStep[]) =>
  steps
    .map(
      (step, index) =>
        `${index + 1}. [${step.id}] ${step.title}${step.detail ? `: ${step.detail}` : ""}`,
    )
    .join("\n");

const stepPrompt = (prompt: string, steps: PlanStep[], step: PlanStep, skillsText = ""): string => {
  const done = agent()
    .steps.filter((s) => s.status === "done" && s.summary)
    .map((s) => `- [${s.id}] ${s.summary}`)
    .join("\n");
  return [
    // Skills first: identical across steps, so the cached prefix keeps covering them.
    skillsText,
    `User request:\n${prompt}`,
    `Plan:\n${planText(steps)}`,
    done ? `Already completed:\n${done}` : "",
    `Current step: [${step.id}] ${step.title}${step.detail ? `\n${step.detail}` : ""}`,
    "Carry out only the current step using the tools, inspecting the document first where needed. " +
      `Call report_step for step id "${step.id}" when it is finished.`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

type StepOutcome = { status: "done" | "failed"; summary?: string };

const executeStep = async (
  ctx: RuntimeContext,
  prompt: string,
  steps: PlanStep[],
  step: PlanStep,
): Promise<StepOutcome> => {
  ctx.host.reportStep(step.id, "running");
  const messages: BetaMessageParam[] = [
    { role: "user", content: stepPrompt(prompt, steps, step, ctx.skillsText) },
  ];
  let lastText = "";

  for (let turn = 0; turn < MAX_TURNS_PER_STEP; turn++) {
    cancelIfAborted(ctx.signal);
    const message = await ctx.client.beta.messages
      .stream(executorRequest(ctx, messages), { signal: ctx.signal })
      .finalMessage();
    recordUsage(message, executorModel(ctx));

    const text = textOf(message);
    if (text) {
      lastText = text;
      agent().appendLog({ kind: "assistant", text });
    }

    // Stop reasons are checked before any tool runs: a refusal or max_tokens can cut a tool_use
    // off mid-input, and that input must never be executed.
    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category;
      return {
        status: "failed",
        summary: `The model declined this step${category ? ` (${category})` : ""}.`,
      };
    }
    if (message.stop_reason === "max_tokens") {
      return { status: "failed", summary: "The model's output was cut off (max_tokens)." };
    }
    if (message.stop_reason === "pause_turn") {
      // Server-side turn paused: append it and resume. (Pego declares no server tools.)
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0) {
      const finished =
        message.stop_reason === "end_turn" || message.stop_reason === "stop_sequence";
      return finished
        ? { status: "done", summary: lastText || undefined }
        : { status: "failed", summary: `Unexpected stop reason: ${message.stop_reason}` };
    }

    // Content (incl. thinking blocks) goes back verbatim so reasoning is preserved.
    messages.push({ role: "assistant", content: message.content });

    // Sequential on purpose: ops mutate one document and order matters.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of toolUses) {
      cancelIfAborted(ctx.signal);
      const result = await runToolUse(block, ctx.host);
      results.push(result);
      agent().appendLog({
        kind: "tool",
        text: "",
        tool: { name: block.name, isError: result.is_error === true },
      });
    }
    // ALL results in ONE user message (splitting them trains the model off parallel calls).
    messages.push({ role: "user", content: results });
  }
  return { status: "failed", summary: "The step used too many turns without finishing." };
};

// ---- run -----------------------------------------------------------------------------------

const finishCancelled = () => {
  const state = agent();
  for (const step of state.steps) {
    if (step.status === "pending" || step.status === "running") {
      state.setStepStatus(step.id, "skipped");
    }
  }
  state.set({ status: "cancelled", decision: null, focusIds: [] });
};

/** Plan with Opus, then execute each step with Sonnet. Never throws: ends in the store. */
export const runApiAgent = async (prompt: string, base: RuntimeContext): Promise<void> => {
  const ctx: RuntimeContext = { ...base }; // private copy: skill text is filled in below
  const state = agent();
  try {
    const skills = resolveRunSkills(prompt, ctx.skillId);
    ctx.skillsText = skillsBlock(skills);
    for (const text of skillLogLines(skills)) state.appendLog({ kind: "info", text });
    state.appendLog({
      kind: "info",
      text: ctx.provider ? `Planning with ${plannerModel(ctx)}` : "Planning with Claude Opus 5.5",
    });
    const steps = await requestPlan(ctx, prompt);
    ctx.host.reportPlan(steps);
    agent().set({ status: "running" });

    for (const [index, step] of steps.entries()) {
      cancelIfAborted(ctx.signal);
      const outcome = await executeStep(ctx, prompt, steps, step);
      const current = agent().steps.find((s) => s.id === step.id);
      // The model usually reports its own step; fill in when it did not (or left it running).
      const reported = current?.status === "done" || current?.status === "failed";
      const status = reported ? current.status : outcome.status;
      if (!reported) ctx.host.reportStep(step.id, status, outcome.summary);
      if (status === "failed") {
        const reason = current?.summary ?? outcome.summary ?? `Step failed: ${step.title}`;
        agent().appendLog({ kind: "error", text: reason });
        for (const rest of steps.slice(index + 1)) agent().setStepStatus(rest.id, "skipped");
        agent().set({ status: "failed", focusIds: [] });
        return;
      }
    }
    agent().set({ status: "done", focusIds: [] });
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error) || error instanceof RunCancelledError) {
      finishCancelled();
      return;
    }
    const message = ctx.provider
      ? describeCompatError(error, ctx.provider)
      : describeApiError(error);
    const current = agent();
    for (const step of current.steps) {
      if (step.status === "running") current.setStepStatus(step.id, "failed", message);
      else if (step.status === "pending") current.setStepStatus(step.id, "skipped");
    }
    current.appendLog({ kind: "error", text: message });
    current.set({ status: "failed", decision: null, focusIds: [] });
  }
};
