import {
  agentTools,
  EXECUTOR_SYSTEM,
  parsePlan,
  PLANNER_SYSTEM,
  planOutputSchema,
  toolByName,
  type PlanStep,
  type RunAttachment,
  type ToolResult,
} from "@pego/agent";
import { attachmentNote, openAiImageParts } from "../attachments";
import { AgentRunError, describeApiError, isAbortError } from "../api-errors";
import { RunCancelledError } from "../decisions";
import { resolveRunSkills, skillLogLines, skillsBlock } from "../run-skills";
import { steerImages, steerText, type SteerInbox, type SteerMessage } from "../steer-inbox";
import { promptWithHistory } from "../sessions/session-context";
import type { AgentToolHost } from "../tool-host";
import type { RunScope } from "../use-agent-store";
import type { CustomProvider } from "./types";

export type OpenAiRunContext = {
  provider: CustomProvider;
  apiKey: string;
  host: AgentToolHost;
  signal: AbortSignal;
  /** Explicit skill for this run: undefined = auto-detect, null = core only. */
  skillId?: string | null;
  /** Explicit style for this run: undefined = auto-detect, null = none. */
  styleId?: string | null;
  /** Images the user attached; sent as `image_url` parts in the planner and first step turns. */
  attachments?: readonly RunAttachment[];
  /** Earlier turns of the session (see sessions/session-context), sent in front of the prompt. */
  history?: string;
  /** Mailbox for messages the user sends into the running agent (read at every turn boundary). */
  steer?: SteerInbox;
};

/*
 * Protocol subset (non-streaming Chat Completions, accepted by OpenAI, OpenRouter, DeepSeek,
 * Groq, Together, Mistral, LM Studio and Ollama /v1):
 *   POST {baseUrl}/chat/completions  { model, messages, tools?, tool_choice?, response_format? }
 *   assistant message { content, tool_calls: [{id, type: "function", function: {name, arguments}}] }
 *   tool result       { role: "tool", tool_call_id, content: string }
 *   images            a following { role: "user", content: [text, image_url(data URL)] } message,
 *                     because tool messages are text-only in this API.
 * Non-streaming on purpose for v1: simplest and most portable; steps are short-lived.
 */

const MAX_TURNS_PER_STEP = 40;
const MAX_TOOL_RESULT_CHARS = 100_000;

// ---- wire types ----------------------------------------------------------------------------

type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatResponse = {
  choices?: {
    finish_reason?: string | null;
    message?: { content?: unknown; tool_calls?: unknown };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** HTTP-level failure from the provider; `detail` is the provider's own error text. */
class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`HTTP ${status}: ${detail}`);
    this.name = "ChatHttpError";
  }
}

type RunState = {
  ctx: OpenAiRunContext;
  /** Cleared for the rest of the run once the provider refuses image input. */
  images: boolean;
  skillsText: string;
};

/** User message: plain text, or text + the attached images as `image_url` parts. */
export const userContent = (
  text: string,
  attachments: readonly RunAttachment[] = [],
): string | ContentPart[] => {
  if (attachments.length === 0) return text;
  const note = attachmentNote(attachments);
  return [
    { type: "text", text: note ? `${note}\n\n${text}` : text },
    ...openAiImageParts(attachments),
  ];
};

/** User message for steer messages: the text, plus `image_url` parts when the provider takes images. */
export const steerMessage = (messages: readonly SteerMessage[], withImages = true): ChatMessage => {
  const images = withImages ? steerImages(messages) : [];
  const text = steerText(messages);
  return {
    role: "user",
    content: images.length === 0 ? text : [{ type: "text", text }, ...openAiImageParts(images)],
  };
};

const cancelIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new RunCancelledError();
};

// ---- transport -----------------------------------------------------------------------------

const errorDetail = async (response: Response, apiKey: string): Promise<string> => {
  const raw = await response.text().catch(() => "");
  let detail = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === "string") detail = error;
    else if (typeof (error as { message?: unknown } | null)?.message === "string") {
      detail = (error as { message: string }).message;
    }
  } catch {
    // keep the raw text
  }
  if (apiKey) detail = detail.split(apiKey).join("[redacted]");
  return detail.trim().slice(0, 300);
};

const chat = async (
  state: RunState,
  body: Record<string, unknown>,
  messages: ChatMessage[],
): Promise<ChatResponse> => {
  const { provider, apiKey, signal } = state.ctx;
  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, messages: state.images ? messages : stripImages(messages) }),
      signal,
    });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    throw new AgentRunError(
      `Could not reach ${provider.name}. The provider may have blocked a browser request (CORS), ` +
        "or the base URL is wrong or the server is offline.",
    );
  }
  if (!response.ok) throw new ChatHttpError(response.status, await errorDetail(response, apiKey));
  try {
    return (await response.json()) as ChatResponse;
  } catch {
    throw new AgentRunError(`${provider.name} returned a response that could not be read.`);
  }
};

const describeError = (error: unknown, provider: CustomProvider): string => {
  if (!(error instanceof ChatHttpError)) return describeApiError(error);
  const { status, detail } = error;
  const suffix = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) {
    return `${provider.name} rejected the API key or the model is not allowed${suffix}. Check the key in agent settings.`;
  }
  if (status === 404) {
    return `${provider.name} could not find the endpoint or model${suffix}. Check the base URL and model id.`;
  }
  if (status === 429)
    return `${provider.name} is rate limiting requests${suffix}. Try again shortly.`;
  if (status >= 500) return `${provider.name} failed (HTTP ${status})${suffix}. Try again shortly.`;
  return `${provider.name} rejected the request (HTTP ${status})${suffix}`;
};

const recordUsage = (state: RunState, response: ChatResponse) => {
  const { usage } = response;
  if (!usage) return;
  // Provider pricing is unknown, so cost stays 0 (tokens only).
  state.ctx.host.run.addUsage({
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    costUsd: 0,
  });
};

const hasImages = (messages: ChatMessage[]) =>
  messages.some(
    (m) => m.role === "user" && Array.isArray(m.content) && m.content.some(isImagePart),
  );

const isImagePart = (part: ContentPart) => part.type === "image_url";

/** Same conversation without image parts (a text note replaces them). */
const stripImages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return message;
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return {
      role: "user",
      content: `${text}\n(Images omitted: this model does not accept images.)`,
    };
  });

const IMAGE_REJECTION = /image|vision|multimodal|modalit/i;

/** `chat` + one retry without images when the provider rejects them (remembered for the run). */
const chatWithImageFallback = async (
  state: RunState,
  body: Record<string, unknown>,
  messages: ChatMessage[],
): Promise<ChatResponse> => {
  try {
    return await chat(state, body, messages);
  } catch (error) {
    const rejected =
      state.images &&
      hasImages(messages) &&
      error instanceof ChatHttpError &&
      error.status === 400 &&
      IMAGE_REJECTION.test(error.detail);
    if (!rejected) throw error;
    state.images = false;
    state.ctx.host.run.appendLog({
      kind: "info",
      text: "This model does not accept images; continuing without them.",
    });
    return chat(state, body, messages);
  }
};

// ---- response parsing ----------------------------------------------------------------------

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n")
    .trim();
};

const firstChoice = (response: ChatResponse, provider: CustomProvider) => {
  const choice = response.choices?.[0];
  if (!choice?.message) {
    throw new AgentRunError(`${provider.name} returned no completion. Check the model id.`);
  }
  return choice;
};

/** Pull the first balanced JSON object out of free text (fences, preamble, trailing prose). */
export const extractJson = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to scanning
  }
  const unfenced = trimmed.replace(/```(?:json)?/gi, "");
  for (let start = unfenced.indexOf("{"); start !== -1; start = unfenced.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < unfenced.length; i++) {
      const char = unfenced[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON object found");
};

const toolCallsOf = (message: { tool_calls?: unknown }, turn: number): ToolCall[] => {
  if (!Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.flatMap((raw, index) => {
    const fn = (raw as { function?: { name?: unknown; arguments?: unknown } } | null)?.function;
    if (!fn || typeof fn.name !== "string") return [];
    const id = (raw as { id?: unknown }).id;
    return [
      {
        // Some local servers omit ids; the assistant message and the tool reply must still agree.
        id: typeof id === "string" && id ? id : `call_${turn}_${index}`,
        type: "function" as const,
        function: {
          name: fn.name,
          arguments:
            typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        },
      },
    ];
  });
};

// ---- planner -------------------------------------------------------------------------------

const PLAN_FORMAT_HINT = `Reply with ONLY a JSON object (no prose, no code fences) matching this JSON schema:\n${JSON.stringify(planOutputSchema)}`;

const JSON_MODE_REJECTION = /response_format|json_object|json mode|json_schema/i;

const requestPlan = async (state: RunState, prompt: string): Promise<PlanStep[]> => {
  const { provider, host } = state.ctx;
  const messages: ChatMessage[] = [
    { role: "system", content: PLANNER_SYSTEM },
    {
      role: "user",
      content: userContent(
        [
          state.skillsText,
          `Current document (JSON):\n${JSON.stringify(host.getDoc())}\n\nUser request:\n${prompt}`,
          PLAN_FORMAT_HINT,
        ]
          .filter(Boolean)
          .join("\n\n"),
        state.ctx.attachments,
      ),
    },
  ];
  const body = { model: provider.plannerModel ?? provider.executorModel };
  let response: ChatResponse;
  try {
    response = await chatWithImageFallback(
      state,
      { ...body, response_format: { type: "json_object" } },
      messages,
    );
  } catch (error) {
    // Providers without JSON mode answer 400; the prompt alone then asks for JSON.
    if (!(
      error instanceof ChatHttpError &&
      error.status === 400 &&
      JSON_MODE_REJECTION.test(error.detail)
    )) {
      throw error;
    }
    response = await chatWithImageFallback(state, body, messages);
  }
  recordUsage(state, response);
  const choice = firstChoice(response, provider);
  if (choice.finish_reason === "length")
    throw new AgentRunError("The plan was cut off (max tokens).");
  try {
    return parsePlan(extractJson(contentText(choice.message?.content)));
  } catch {
    throw new AgentRunError("The planner returned a plan that could not be read. Try again.");
  }
};

// ---- executor ------------------------------------------------------------------------------

const executorTools = agentTools.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
}));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncate = (text: string) =>
  text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated ${text.length - MAX_TOOL_RESULT_CHARS} characters]`
    : text;

const errorResult = (content: string): ToolResult => ({ content, isError: true });

/** Run one tool call; malformed arguments become an error result the model can correct. */
const runToolCall = async (call: ToolCall, host: AgentToolHost): Promise<ToolResult> => {
  const spec = toolByName(call.function.name);
  if (!spec) return errorResult(`Unknown tool: ${call.function.name}`);
  const raw = call.function.arguments;
  let input: unknown;
  try {
    input = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return errorResult(
      JSON.stringify({ INVALID_JSON: raw.slice(0, 2000), error: "arguments are not valid JSON" }),
    );
  }
  if (!isRecord(input)) {
    return errorResult(
      JSON.stringify({
        INVALID_JSON: raw.slice(0, 2000),
        error: "tool input must be a JSON object",
      }),
    );
  }
  try {
    return await spec.run(input, host);
  } catch (error) {
    if (error instanceof RunCancelledError) throw error;
    return errorResult(error instanceof Error ? error.message : "tool failed");
  }
};

const planText = (steps: PlanStep[]) =>
  steps
    .map(
      (step, index) =>
        `${index + 1}. [${step.id}] ${step.title}${step.detail ? `: ${step.detail}` : ""}`,
    )
    .join("\n");

const stepPrompt = (
  run: RunScope,
  prompt: string,
  steps: PlanStep[],
  step: PlanStep,
  skillsText: string,
) => {
  const done = (run.get()?.steps ?? [])
    .filter((s) => s.status === "done" && s.summary)
    .map((s) => `- [${s.id}] ${s.summary}`)
    .join("\n");
  return [
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
  state: RunState,
  prompt: string,
  steps: PlanStep[],
  step: PlanStep,
): Promise<StepOutcome> => {
  const { provider, host, signal } = state.ctx;
  host.reportStep(step.id, "running");
  // Steers sent while planning or between steps are read now; earlier ones stay in every later step.
  state.ctx.steer?.drain();
  const followUps = state.ctx.steer?.delivered() ?? [];
  const stepText = stepPrompt(state.ctx.host.run, prompt, steps, step, state.skillsText);
  const messages: ChatMessage[] = [
    { role: "system", content: EXECUTOR_SYSTEM },
    {
      role: "user",
      content: userContent(
        followUps.length > 0 ? `${stepText}\n\n${steerText(followUps)}` : stepText,
        [...(state.ctx.attachments ?? []), ...steerImages(followUps)],
      ),
    },
  ];
  let lastText = "";

  for (let turn = 0; turn < MAX_TURNS_PER_STEP; turn++) {
    cancelIfAborted(signal);
    const response = await chatWithImageFallback(
      state,
      { model: provider.executorModel, tools: executorTools, tool_choice: "auto" },
      messages,
    );
    recordUsage(state, response);
    const choice = firstChoice(response, provider);
    const message = choice.message ?? {};
    const text = contentText(message.content);
    if (text) {
      lastText = text;
      state.ctx.host.run.appendLog({ kind: "assistant", text });
    }

    // Truncated or filtered output is never executed: a cut-off tool call has partial arguments.
    if (choice.finish_reason === "length") {
      return { status: "failed", summary: "The model's output was cut off (max tokens)." };
    }
    if (choice.finish_reason === "content_filter") {
      return { status: "failed", summary: "The provider's content filter stopped this step." };
    }

    const calls = toolCallsOf(message, turn);
    if (calls.length === 0) {
      // A steer that arrived during this last turn gets its answer before the step closes.
      const late = state.ctx.steer?.drain() ?? [];
      if (late.length === 0) return { status: "done", summary: lastText || undefined };
      messages.push({ role: "assistant", content: text || null });
      messages.push(steerMessage(late, state.images));
      continue;
    }

    messages.push({ role: "assistant", content: text || null, tool_calls: calls });

    // Sequential on purpose: ops mutate one document and order matters.
    const images: ContentPart[] = [];
    for (const call of calls) {
      cancelIfAborted(signal);
      const result = await runToolCall(call, host);
      messages.push({ role: "tool", tool_call_id: call.id, content: truncate(result.content) });
      for (const image of result.images ?? []) {
        images.push({
          type: "image_url",
          image_url: { url: `data:${image.mediaType};base64,${image.data}` },
        });
      }
      host.run.appendLog({
        kind: "tool",
        text: "",
        tool: { name: call.function.name, isError: result.isError },
      });
    }
    // Tool messages are text-only, so screenshots follow in ONE user message after all of them.
    if (images.length > 0 && state.images) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: "Screenshots from the tool calls above." }, ...images],
      });
    }
    const steers = state.ctx.steer?.drain() ?? [];
    if (steers.length > 0) messages.push(steerMessage(steers, state.images));
  }
  return { status: "failed", summary: "The step used too many turns without finishing." };
};

// ---- run -----------------------------------------------------------------------------------

const finishCancelled = (run: RunScope) => {
  for (const step of run.get()?.steps ?? []) {
    if (step.status === "pending" || step.status === "running") {
      run.setStepStatus(step.id, "skipped");
    }
  }
  run.set({ status: "cancelled", decision: null, focusIds: [] });
};

/**
 * Plan + execute with an OpenAI-compatible Chat Completions API (tools as functions).
 * Same store contract as `runApiAgent`: never throws, ends the run in the agent store.
 */
export const runOpenAiCompatibleAgent = async (
  prompt: string,
  ctx: OpenAiRunContext,
): Promise<void> => {
  const run = ctx.host.run;
  try {
    const skills = resolveRunSkills(prompt, ctx.skillId, ctx.styleId);
    const state: RunState = { ctx, images: true, skillsText: skillsBlock(skills) };
    for (const text of skillLogLines(skills)) run.appendLog({ kind: "info", text });
    run.appendLog({
      kind: "info",
      text: `Planning with ${ctx.provider.plannerModel ?? ctx.provider.executorModel} (${ctx.provider.name})`,
    });
    // Skills above follow the user's own words; the model also gets the session memory.
    const request = promptWithHistory(prompt, ctx.history);
    const steps = await requestPlan(state, request);
    ctx.host.reportPlan(steps);
    run.set({ status: "running" });

    for (const [index, step] of steps.entries()) {
      cancelIfAborted(ctx.signal);
      const outcome = await executeStep(state, request, steps, step);
      const current = run.get()?.steps.find((s) => s.id === step.id);
      // The model usually reports its own step; fill in when it did not (or left it running).
      const reported = current?.status === "done" || current?.status === "failed";
      const status = reported ? current.status : outcome.status;
      if (!reported) ctx.host.reportStep(step.id, status, outcome.summary);
      if (status === "failed") {
        const reason = current?.summary ?? outcome.summary ?? `Step failed: ${step.title}`;
        run.appendLog({ kind: "error", text: reason });
        for (const rest of steps.slice(index + 1)) run.setStepStatus(rest.id, "skipped");
        run.set({ status: "failed", focusIds: [] });
        return;
      }
    }
    run.set({ status: "done", focusIds: [] });
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error) || error instanceof RunCancelledError) {
      finishCancelled(run);
      return;
    }
    const message = describeError(error, ctx.provider);
    for (const step of run.get()?.steps ?? []) {
      if (step.status === "running") run.setStepStatus(step.id, "failed", message);
      else if (step.status === "pending") run.setStepStatus(step.id, "skipped");
    }
    run.appendLog({ kind: "error", text: message });
    run.set({ status: "failed", decision: null, focusIds: [] });
  }
};
