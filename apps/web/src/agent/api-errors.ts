import Anthropic from "@anthropic-ai/sdk";

/** Raised by the runtime for non-API failures that should end the run with a clear message. */
export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunError";
  }
}

/** Map an SDK error to one user-facing sentence. Never includes request headers or the key. */
export const describeApiError = (error: unknown): string => {
  if (error instanceof AgentRunError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "API key invalid. Check the key in agent settings.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "This API key is not allowed to use the requested model.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = error.headers?.get("retry-after");
    return retryAfter
      ? `Rate limited by Anthropic. Retry in ${retryAfter}s.`
      : "Rate limited by Anthropic. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "Anthropic is overloaded or unavailable. Try again shortly.";
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "The request to Anthropic timed out. Try again.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach api.anthropic.com. Check your connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? ""}: ${error.message}`.replace("  ", " ");
  }
  return error instanceof Error ? error.message : "Unknown error";
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Anthropic.APIUserAbortError ||
  (error instanceof DOMException && error.name === "AbortError");
