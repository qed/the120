import "server-only";

/**
 * The ONE file that talks to a model (funnel U10). Provider-agnostic by
 * decision: the model is a "provider/model" gateway string read from
 * `FUNNEL_COMPOSE_MODEL` at call time — no provider SDK import anywhere.
 * Unset env is a first-class outcome (`unconfigured`) that the taxonomy
 * maps to the canned fallback: the funnel never dead-ends on configuration
 * (R40). ZDR with the chosen provider is a Peter-owned launch precondition.
 *
 * Every failure normalizes to `NormalizedModelResult` HERE, so the pure
 * taxonomy (`composeBranch`) is the only place that decides what happens
 * next. Note the refusal path: the SDK throws NoObjectGeneratedError when
 * a refusal or truncation yields unparseable text — the error still carries
 * `finishReason`, which is what R40a's "read stop_reason before content"
 * means in this SDK's shape.
 */

import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  generateText,
} from "ai";
import {
  composedProjectSchema,
  type NormalizedModelResult,
} from "@/app/lib/funnel/compose-rules";

export const COMPOSE_TIMEOUT_MS = 25_000;

export function composeModelId(): string | null {
  const id = process.env.FUNNEL_COMPOSE_MODEL?.trim();
  return id && id.length > 0 ? id : null;
}

export async function generateComposeDraft(parts: {
  system: string;
  prompt: string;
}): Promise<NormalizedModelResult> {
  const model = composeModelId();
  if (!model) return { type: "unconfigured" };
  try {
    const result = await generateText({
      model,
      system: parts.system,
      prompt: parts.prompt,
      temperature: 0,
      output: Output.object({ schema: composedProjectSchema }),
      abortSignal: AbortSignal.timeout(COMPOSE_TIMEOUT_MS),
      // The retry policy is OURS (composeBranch owns the taxonomy; the core
      // owns the single backoff retry). The SDK default of 2 internal
      // retries would make each "one ask" cost up to 3 provider requests —
      // amplifying the very 429 storm the taxonomy handles — and wraps the
      // exhausted error in RetryError, which would dodge the 429 check below.
      maxRetries: 0,
    });
    return {
      type: "response",
      finishReason: result.finishReason,
      object: result.output,
    };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // A response happened; its text just wasn't the schema. The finish
      // reason survives on the error, so refusal/truncation still classify
      // as themselves rather than as invalid JSON.
      return {
        type: "response",
        finishReason: err.finishReason ?? "stop",
        object: null,
      };
    }
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      return { type: "timeout" };
    }
    if (APICallError.isInstance(err) && err.statusCode === 429) {
      return { type: "rate_limited" };
    }
    console.error(
      "[funnel/compose] model call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return {
      type: "error",
      message: err instanceof Error ? err.message : "unknown",
    };
  }
}
