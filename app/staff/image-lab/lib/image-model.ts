import "server-only";

/**
 * Image Lab — the ONE file that talks to image models.
 *
 * Sibling in discipline to `app/lib/funnel/compose-model.ts`, the repo's
 * existing "one file that talks to a model", and deliberately the same shape:
 *
 *   • gateway `"provider/model"` strings only. NO provider SDK is imported and
 *     none may be added to package.json — gateway auth is implicit (existing
 *     key or Vercel OIDC), which is also why nothing here sniffs an API key.
 *   • `AbortSignal.timeout`, sized per registry entry.
 *   • `maxRetries: 0`. The retry policy is OURS: the SDK's default of 2
 *     internal retries would turn one staff click into three PAID image
 *     generations, and the Lab's retry story is an explicit new row after a
 *     staleness window, not an invisible triple-spend.
 *   • EVERY outcome — including "the bench is switched off" — normalizes into
 *     `NormalizedImageResult`, so no caller ever sees a vendor exception.
 *
 * The pure half (the result union, the closed sets, the sniff, the billing
 * rule) lives in ./image-model-rules so the client-side history and keep-rate
 * views can import it without dragging `server-only` and the SDK into the
 * browser bundle.
 *
 * ── What is different from the text sibling, and why ───────────────────────
 * Two things, both consequences of images being BYTES that get STORED and then
 * SERVED into a staff browser from the storage origin:
 *
 * 1. TWO CALL PATHS. `openai/gpt-image-2` is Images-API-only and is reached
 *    with `generateImage` (images in `result.images`); the Gemini image models
 *    are reached with multimodal `generateText` and return images in
 *    `result.files` — NOT `result.images`, which does not exist on that result.
 *    Both hide behind one `generateLabImage()`, and both hand file selection to
 *    the SAME `pickUsableFile` so the legs cannot disagree about which byte
 *    array was the answer.
 *
 * 2. THE BYTES ARE SNIFFED, AND THE SNIFF IS THE ONLY SOURCE OF CONTENT TYPE.
 *    A vendor-declared `mediaType` is an assertion by a remote party about a
 *    payload we are about to persist in a private bucket and hand back to a
 *    staff browser via signed URL. Declared `image/png` over an HTML or SVG
 *    body would be stored, served on the storage origin, and executed there.
 *
 * ── Classification reads STRUCTURE, never prose ────────────────────────────
 * Two rules that are easy to get wrong and were both wrong here before review:
 *
 *   • Gateway errors are NOT `APICallError`. `@ai-sdk/gateway` funnels every
 *     vendor failure through `asGatewayError`, which returns a `GatewayError`
 *     subclass — `GatewayError extends Error` and carries no APICallError
 *     marker. Classifying on `APICallError.isInstance` alone makes every real
 *     production failure `unknown_error`. See {@link gatewayShapeOf}.
 *
 *   • Safety is decided from STRUCTURED fields only (the gateway error `type`,
 *     a parsed JSON error `code`/`type`, a finish reason) and NEVER from
 *     `err.message` or `responseBody` free text. Vendor bodies echo the prompt,
 *     and the prompt is child-authored business text — so a child selling "Bike
 *     Safety Kits" would have had every unrelated 500 classified as a safety
 *     block, excluded from the keep-rate denominator, with staff told to reword
 *     a prompt that was never the problem.
 */

import {
  APICallError,
  NoImageGeneratedError,
  generateImage,
  generateText,
} from "ai";
import { isImageLabLive, type ImageLabMimeType } from "./image-lab-rules";
import {
  IMAGE_LAB_SAFETY_REASONS,
  pickUsableFile,
  type ImageLabFailureDetail,
  type ImageLabFailureLogCode,
  type ImageLabGeneratedFile,
  type ImageLabSafetyReason,
  type ImageLabTimeoutCause,
  type NormalizedImageResult,
} from "./image-model-rules";
import {
  estimatedCostUsd,
  findModelEntry,
  type ImageLabModelEntry,
} from "./model-registry";

/**
 * The registry's provider options, un-frozen for the wire.
 *
 * The registry is deeply FROZEN so no consumer can edit the shared table; the
 * SDK's parameter type is mutable. The deep clone in {@link providerOptionsFor}
 * bridges the two — and it is a real defence, not a type-appeasing copy: handing
 * the SAME object to an SDK that normalizes in place would let one request
 * permanently change the response modality of every later request in a warm
 * serverless instance.
 */
type MutableProviderOptions = Record<string, Record<string, string | string[]>>;

// ── The go-live flag ─────────────────────────────────────────────────────────

/**
 * Re-exported from the PLAIN `./image-lab-rules`, where the implementation now
 * lives, so existing importers of `@/app/staff/image-lab/lib/image-model` keep
 * working unchanged.
 *
 * The move is the repo's documented split (docs/solutions/best-practices/
 * server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md):
 * reading one env var must not drag `server-only`, the `ai` SDK and the model
 * registry into a caller. `/staff`'s hub card needs exactly this boolean and
 * nothing else in this file — importing it from here made the staff front door
 * pay for the whole image stack, and pushed
 * `app/staff/__tests__/staff-route.test.ts` (which dynamic-imports that page)
 * against the 5000ms default timeout on a cold run.
 *
 * NEW CALLERS THAT ONLY WANT THE FLAG SHOULD IMPORT `./image-lab-rules`.
 */
export { isImageLabLive } from "./image-lab-rules";

// ── Injected edges ───────────────────────────────────────────────────────────

/** The `generateImage` leg, narrowed to what is called and read. */
export type ImageLabGenerateImageFn = (options: {
  model: string;
  prompt: string | { images: Uint8Array[]; text?: string };
  n: number;
  maxRetries: number;
  abortSignal: AbortSignal;
  providerOptions?: MutableProviderOptions;
}) => Promise<{
  readonly images: readonly ImageLabGeneratedFile[];
  readonly providerMetadata?: unknown;
}>;

/** The multimodal leg, likewise narrowed. */
export type ImageLabGenerateTextFn = (options: {
  model: string;
  messages: Array<{
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: Uint8Array; mediaType: string }
    >;
  }>;
  maxRetries: number;
  abortSignal: AbortSignal;
  providerOptions?: MutableProviderOptions;
}) => Promise<{
  readonly files: readonly ImageLabGeneratedFile[];
  readonly finishReason: string;
  readonly rawFinishReason?: string | undefined;
  readonly providerMetadata?: unknown;
}>;

/**
 * Deps, all optional — production passes none. Injected rather than module-
 * mocked so the tests exercise the REAL branching, and so "no generator call was
 * made" is an assertion a fake can make rather than a claim a comment makes.
 */
export type ImageModelDeps = {
  generateImage?: ImageLabGenerateImageFn;
  generateText?: ImageLabGenerateTextFn;
  /** Overridable so the flag tests never touch process.env. */
  isLive?: () => boolean;
  /**
   * The timeout-signal factory. Injectable for ONE reason: it is the only way to
   * prove that a model's own `timeoutMs` — not a hardcoded number — reaches the
   * call. `AbortSignal.timeout` is backed by a native timer that fake timers
   * cannot advance, so without this seam the strongest possible assertion is
   * "some AbortSignal was passed", which stays green if every entry's timeout is
   * swapped. Production always uses the real one.
   */
  timeoutSignal?: (ms: number) => AbortSignal;
};

/**
 * Real adapters, written as thin wrappers rather than passing the SDK functions
 * directly: the wrapper is where `maxRetries` and the abort signal are proven to
 * reach the SDK, and it keeps the narrow deps types above from having to mirror
 * v7's very large call-option surface.
 *
 * Exported so they are TESTABLE. They are the only place `maxRetries: 0` reaches
 * the vendor, and an unexercised wrapper means deleting that line is a silent
 * 3× spend with a green suite.
 */
export const realGenerateImage: ImageLabGenerateImageFn = async (options) => {
  const result = await generateImage({
    model: options.model,
    prompt: options.prompt,
    n: options.n,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    ...(options.providerOptions
      ? { providerOptions: options.providerOptions }
      : {}),
  });
  return { images: result.images, providerMetadata: result.providerMetadata };
};

export const realGenerateText: ImageLabGenerateTextFn = async (options) => {
  const result = await generateText({
    model: options.model,
    messages: options.messages,
    maxRetries: options.maxRetries,
    abortSignal: options.abortSignal,
    ...(options.providerOptions
      ? { providerOptions: options.providerOptions }
      : {}),
  });
  return {
    files: result.files,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    providerMetadata: result.providerMetadata,
  };
};

// ── The entry point ──────────────────────────────────────────────────────────

export type ImageGenerationRequest = {
  /** Registry key (the DB's `model_id`), NOT a gateway string. */
  modelId: string;
  /** The fully resolved prompt. Never logged, never echoed back in a failure. */
  prompt: string;
  /**
   * Quality tier. A tier the registry does not price is REFUSED, not ignored:
   * dialling it would run at the vendor's own default (OpenAI's `auto`, which
   * may pick `high` at $0.211 — 35× low) while `estimatedCostUsd` returns null,
   * so the single priciest run in the table would contribute zero cost evidence.
   */
  quality?: string | null;
  /**
   * Reference images, already sniff-validated upstream at registration. Trimmed
   * to the model's `refImageLimit` HERE rather than refused: a compare run fans
   * the identical input at models whose limits differ (4 vs 11 vs 14), and
   * refusing the whole cell would make the cheapest model the one that decides
   * how many references the drill may use.
   */
  referenceImages?: readonly {
    bytes: Uint8Array;
    contentType: ImageLabMimeType;
  }[];
  /**
   * The caller's own cancellation. Composed with (not replacing) the model
   * timeout, so a route can enforce its residual budget and a compare fan can
   * cancel siblings — and an abort from HERE is recorded as `caller_aborted`,
   * which does not bill.
   */
  abortSignal?: AbortSignal;
};

export async function generateLabImage(
  request: ImageGenerationRequest,
  deps: ImageModelDeps = {}
): Promise<NormalizedImageResult> {
  const isLive = deps.isLive ?? isImageLabLive;

  // Flag first, and BEFORE the registry lookup, so "the bench is off" is
  // answered without touching anything that could reach a network.
  if (!isLive()) return { kind: "unconfigured" };

  // Fails closed. A model id that is not in the registry has no gateway string,
  // no timeout and no price — there is nothing to dial and nothing to cost.
  const entry = findModelEntry(request.modelId);
  if (!entry) return { kind: "unconfigured" };

  // Refuse an unpriced tier BEFORE dialling. See ImageGenerationRequest.quality.
  if (request.quality != null && estimatedCostUsd(entry, request.quality) === null) {
    return failProvider(entry, "unsupported_quality_tier");
  }

  // Already cancelled: never dial, and never bill.
  if (request.abortSignal?.aborted) {
    return failTimeout(entry, "caller_aborted");
  }

  const makeTimeout = deps.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  const timeoutSignal = makeTimeout(entry.timeoutMs);
  const abortSignal = request.abortSignal
    ? AbortSignal.any([timeoutSignal, request.abortSignal])
    : timeoutSignal;

  const references = (request.referenceImages ?? []).slice(0, entry.refImageLimit);

  try {
    return entry.path === "generateImage"
      ? await runGenerateImagePath(entry, request, references, abortSignal, deps)
      : await runMultimodalPath(entry, request, references, abortSignal, deps);
  } catch (err) {
    return classifyThrown(err, {
      entry,
      timeoutSignal,
      callerSignal: request.abortSignal,
    });
  }
}

// ── Path 1: generateImage (openai/gpt-image-2) ───────────────────────────────

async function runGenerateImagePath(
  entry: ImageLabModelEntry,
  request: ImageGenerationRequest,
  references: readonly { bytes: Uint8Array; contentType: ImageLabMimeType }[],
  abortSignal: AbortSignal,
  deps: ImageModelDeps
): Promise<NormalizedImageResult> {
  const call = deps.generateImage ?? realGenerateImage;
  const result = await call({
    model: entry.gatewayModel,
    // The SDK's prompt is either a bare string or an edit-style object. Using
    // the object form ONLY when references exist keeps the plain text-to-image
    // call on the shape the model definitely supports — reference carriage
    // through the gateway is this entry's open verify item.
    prompt:
      references.length > 0
        ? { images: references.map((ref) => ref.bytes), text: request.prompt }
        : request.prompt,
    n: 1,
    maxRetries: 0,
    abortSignal,
    ...providerOptionsFor(entry, request),
  });

  return acceptFiles(entry, result.images, result.providerMetadata);
}

// ── Path 2: multimodal generateText (the Gemini image models) ────────────────

async function runMultimodalPath(
  entry: ImageLabModelEntry,
  request: ImageGenerationRequest,
  references: readonly { bytes: Uint8Array; contentType: ImageLabMimeType }[],
  abortSignal: AbortSignal,
  deps: ImageModelDeps
): Promise<NormalizedImageResult> {
  const call = deps.generateText ?? realGenerateText;
  const result = await call({
    model: entry.gatewayModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: request.prompt },
          ...references.map((ref) => ({
            type: "file" as const,
            data: ref.bytes,
            mediaType: ref.contentType,
          })),
        ],
      },
    ],
    maxRetries: 0,
    abortSignal,
    ...providerOptionsFor(entry, request),
  });

  // ORDER MATTERS: the finish reason is read BEFORE the content, so a refusal
  // classifies as itself rather than as "zero files". A block reported through
  // finishReason with an empty files array would otherwise land as
  // provider_error and be counted in the keep-rate denominator that deliberately
  // excludes safety blocks.
  const safety = classifySafetyFinish(
    result.finishReason,
    result.rawFinishReason,
    entry
  );
  if (safety) return safety;

  return acceptFiles(entry, result.files, result.providerMetadata);
}

// ── Shared normalization ─────────────────────────────────────────────────────

function providerOptionsFor(
  entry: ImageLabModelEntry,
  request: ImageGenerationRequest
): { providerOptions?: MutableProviderOptions } {
  const base = entry.providerOptions
    ? (JSON.parse(JSON.stringify(entry.providerOptions)) as MutableProviderOptions)
    : undefined;
  // Quality rides as an OpenAI body parameter, and only for a value the entry
  // declares WIRE-LEGAL. Reading the price keys instead would send `quality:
  // "standard"` for a single-tier model and 400 every call — the price map is
  // our pricing vocabulary, not the vendor's enum.
  const quality = request.quality ?? entry.qualityDefault;
  const wantsQuality =
    entry.provider === "openai" && (entry.apiQualityValues?.includes(quality) ?? false);
  if (!base && !wantsQuality) return {};
  const merged = base ?? {};
  if (wantsQuality) merged.openai = { ...(merged.openai ?? {}), quality };
  return { providerOptions: merged };
}

/**
 * Turn whatever a model returned into an outcome, using the ONE shared file
 * picker so both legs behave identically.
 */
function acceptFiles(
  entry: ImageLabModelEntry,
  files: readonly ImageLabGeneratedFile[],
  providerMetadata: unknown
): NormalizedImageResult {
  const pick = pickUsableFile(files);
  if (!pick.ok) return failProvider(entry, pick.detail);

  if (pick.discarded > 0) {
    // Visible on purpose: a thinking model emitting drafts means the count is
    // routine, but a count that suddenly changes is how a modality or ordering
    // regression announces itself. A COUNT only — never the bytes, never a type.
    console.warn(
      `[image-lab] ${entry.id} returned ${pick.discarded + 1} usable images; kept the last`
    );
  }

  const gateway = readGatewayMetadata(providerMetadata);
  return {
    kind: "generated",
    bytes: pick.file.uint8Array,
    contentType: pick.contentType,
    gatewayGenerationId: gateway.generationId,
    costReportedUsd: gateway.costUsd,
  };
}

/**
 * Pull the gateway's observability breadcrumbs out of provider metadata.
 *
 * Entirely defensive and entirely nullable: image-modality parity for gateway
 * cost reporting is UNVERIFIED (see the registry's `verified.costReporting`), so
 * absent fields are the expected case, not a fault. Cost is accepted only as a
 * finite number — a string "0.13" is a shape this code has not confirmed, and
 * coercing it would silently invent evidence.
 */
function readGatewayMetadata(providerMetadata: unknown): {
  generationId: string | null;
  costUsd: number | null;
} {
  const gateway =
    providerMetadata && typeof providerMetadata === "object"
      ? (providerMetadata as Record<string, unknown>).gateway
      : undefined;
  if (!gateway || typeof gateway !== "object") {
    return { generationId: null, costUsd: null };
  }
  const record = gateway as Record<string, unknown>;
  const generationId =
    typeof record.generationId === "string" && record.generationId.length > 0
      ? record.generationId
      : null;
  const costUsd =
    typeof record.cost === "number" && Number.isFinite(record.cost)
      ? record.cost
      : null;
  return { generationId, costUsd };
}

// ── Safety classification (structured signals only) ──────────────────────────

/**
 * Vendor safety vocabulary. Matched with word boundaries against SHORT,
 * STRUCTURED values only — a finish reason, or a `code`/`type` field parsed out
 * of a JSON error body. Never against `err.message` or a raw response body.
 *
 * The bare tokens SAFETY and BLOCKED are the reason this restriction exists: a
 * vendor body quotes the prompt, and a child's product may legitimately be
 * "Bike Safety Kits". Matching those words in free text turned every unrelated
 * 500 for that child into `safety_blocked` — unbilled, dropped from the
 * keep-rate denominator, and reported to staff as "reword your prompt".
 * `SAFETY` survives HERE because a structured `blockReason` of exactly `SAFETY`
 * is a real Gemini value and cannot contain a sentence.
 */
const SAFETY_SIGNAL_PATTERN =
  /\b(?:PROHIBITED_CONTENT|PERSON_GENERATION|IMAGE_SAFETY|RECITATION|SAFETY|content_policy_violation|content[_-]?filter|safety_violation|moderation_blocked)\b/i;

/** The subset that means "people/characters", for the actionable wording. */
const PERSON_BLOCK_PATTERN = /\b(?:PROHIBITED_CONTENT|PERSON_GENERATION)\b/i;

/**
 * A structured value is a machine token, and a machine token is short. The cap
 * is a second guard on the same worry as the pattern: if a vendor ever stuffed a
 * prose message into a `code` field, it would not be treated as a signal.
 */
const MAX_STRUCTURED_SIGNAL_LENGTH = 64;

/** Fields that carry a CODE rather than a sentence, at any nesting depth. */
const STRUCTURED_SIGNAL_KEYS = [
  "code",
  "type",
  "status",
  "reason",
  "blockReason",
  "finishReason",
];

function collectStructuredSignals(
  value: unknown,
  out: string[],
  depth = 0
): string[] {
  if (depth > 4 || value === null || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      STRUCTURED_SIGNAL_KEYS.includes(key) &&
      typeof raw === "string" &&
      raw.length <= MAX_STRUCTURED_SIGNAL_LENGTH
    ) {
      out.push(raw);
    } else if (raw !== null && typeof raw === "object") {
      collectStructuredSignals(raw, out, depth + 1);
    }
  }
  return out;
}

/**
 * Every structured signal an error carries: the gateway's own `type`, the parsed
 * JSON error body's `code`/`type`, and the same for a wrapped `cause` (the
 * gateway keeps the original APICallError there).
 */
function structuredSignalsOf(err: unknown, depth = 0): string[] {
  if (depth > 3 || !(err instanceof Error)) return [];
  const signals: string[] = [];
  const candidate = err as unknown as {
    type?: unknown;
    responseBody?: unknown;
    data?: unknown;
    cause?: unknown;
  };

  if (
    typeof candidate.type === "string" &&
    candidate.type.length <= MAX_STRUCTURED_SIGNAL_LENGTH
  ) {
    signals.push(candidate.type);
  }
  if (candidate.data !== undefined) {
    collectStructuredSignals(candidate.data, signals);
  }
  if (typeof candidate.responseBody === "string") {
    try {
      collectStructuredSignals(JSON.parse(candidate.responseBody), signals);
    } catch {
      // Not JSON — then it is free text, and free text is never a safety signal.
    }
  }
  if (candidate.cause !== undefined) {
    signals.push(...structuredSignalsOf(candidate.cause, depth + 1));
  }
  return signals;
}

function safetyReasonFor(
  signals: readonly string[],
  entry: ImageLabModelEntry
): ImageLabSafetyReason {
  // The person-generation wording is only actionable where the allowlist
  // applies; on OpenAI the same finish would be ordinary moderation, and telling
  // staff to chase a Google allowlist would send them somewhere useless.
  return signals.some((signal) => PERSON_BLOCK_PATTERN.test(signal)) &&
    entry.provider === "google"
    ? IMAGE_LAB_SAFETY_REASONS.personGeneration
    : IMAGE_LAB_SAFETY_REASONS.generic;
}

function classifySafetyFinish(
  finishReason: string | undefined,
  rawFinishReason: string | undefined,
  entry: ImageLabModelEntry
): NormalizedImageResult | null {
  const signals = [finishReason ?? "", rawFinishReason ?? ""];
  // `content-filter` is the SDK's UNIFIED finish reason; the raw one carries the
  // vendor's own token (PROHIBITED_CONTENT, IMAGE_SAFETY…). Either is enough:
  // relying on the unified value alone misses vendors the SDK maps to `other`,
  // and relying on the raw value alone misses providers that normalize early.
  if (
    finishReason === "content-filter" ||
    signals.some((signal) => SAFETY_SIGNAL_PATTERN.test(signal))
  ) {
    return failSafety(entry, safetyReasonFor(signals, entry));
  }
  return null;
}

// ── Thrown-error classification ──────────────────────────────────────────────

/**
 * The duck-typed view of a `GatewayError`.
 *
 * VERIFIED against the installed `@ai-sdk/gateway` (v4.0.30):
 * `GatewayError extends Error` with an abstract `type: string` and a concrete
 * `statusCode: number`. Its subclasses' `type` values are exactly
 * `authentication_error`, `failed_dependency`, `forbidden`,
 * `internal_server_error`, `invalid_request_error`, `model_not_found`,
 * `rate_limit_exceeded`, `response_error`, and `timeout_error`.
 *
 * Duck-typed rather than imported because `@ai-sdk/gateway` is a TRANSITIVE
 * dependency, not a declared one, and this module's contract is that it adds no
 * provider package to package.json. The shape it reads (`type` + `statusCode`)
 * is the stable, documented surface of the base class.
 */
type GatewayErrorShape = { readonly type: string; readonly statusCode?: number };

function gatewayShapeOf(err: unknown): GatewayErrorShape | null {
  if (!(err instanceof Error)) return null;
  const candidate = err as unknown as { type?: unknown; statusCode?: unknown };
  if (typeof candidate.type !== "string") return null;
  return {
    type: candidate.type,
    statusCode:
      typeof candidate.statusCode === "number" ? candidate.statusCode : undefined,
  };
}

type ClassifyContext = {
  entry: ImageLabModelEntry;
  timeoutSignal: AbortSignal;
  callerSignal?: AbortSignal | undefined;
};

/**
 * Every thrown outcome, normalized. Nothing escapes this function — a caller
 * never needs a try/catch, which is what lets the route finalize a row on every
 * path (origin R3: one model's failure never blanks a run).
 */
function classifyThrown(
  err: unknown,
  ctx: ClassifyContext
): NormalizedImageResult {
  const { entry } = ctx;

  // ── Aborts are decided from the SIGNAL, not the error ─────────────────────
  // `AbortSignal.timeout` rejects with a DOMException named "TimeoutError" that
  // has no `.code`, so the gateway's own timeout detection misses it and re-wraps
  // it as a GatewayResponseError named "GatewayResponseError". Matching on the
  // thrown error's NAME therefore fails exactly when it matters most, and the
  // priciest model's most expensive outcome gets recorded as unbilled. The
  // signal, by contrast, is unambiguous and local.
  if (ctx.callerSignal?.aborted) return failTimeout(entry, "caller_aborted");
  if (ctx.timeoutSignal.aborted) return failTimeout(entry, "adapter_timeout");

  const gateway = gatewayShapeOf(err);
  const signals = structuredSignalsOf(err);

  // Belt-and-braces for a timeout the signals did not catch (a gateway-side
  // deadline, or an undici timeout the SDK wrapped).
  if (
    gateway?.type === "timeout_error" ||
    gateway?.statusCode === 408 ||
    (err instanceof Error &&
      (err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        err.name === "GatewayTimeoutError")) ||
    (err instanceof Error &&
      err.cause instanceof Error &&
      (err.cause.name === "TimeoutError" || err.cause.name === "AbortError"))
  ) {
    return failTimeout(entry, "adapter_timeout");
  }

  const status =
    gateway?.statusCode ??
    (APICallError.isInstance(err) ? err.statusCode : undefined);

  if (gateway?.type === "rate_limit_exceeded" || status === 429) {
    return failRateLimited(entry);
  }

  // A safety block usually arrives as a 400 whose STRUCTURED body names the
  // vendor's token. The token is matched and then discarded; nothing from the
  // vendor's message is returned or logged.
  if (signals.some((signal) => SAFETY_SIGNAL_PATTERN.test(signal))) {
    return failSafety(entry, safetyReasonFor(signals, entry));
  }

  // "The call returned, but produced no image." Distinct from a thrown API error
  // and worth its own code: it is the shape a mis-specified modality takes, and
  // it IS billable.
  if (NoImageGeneratedError.isInstance(err)) {
    return failProvider(entry, "no_image_returned");
  }

  if (gateway || APICallError.isInstance(err)) {
    return failProvider(
      entry,
      typeof status === "number" ? `api_error:${status}` : "api_error"
    );
  }

  return failProvider(entry, "unknown_error");
}

// ── Failure constructors (every one of them logs, exactly once) ──────────────

/**
 * The ONLY failure logging in this module, and it prints exactly two facts:
 * which model and which code. No prompt, no slot values, no vendor message
 * (which may quote the prompt), no bytes.
 *
 * `unconfigured` is deliberately NOT logged: the bench being switched off is the
 * routine state, not a fault, and logging it would print a line per cell per
 * compare run forever.
 */
function logFailure(
  entry: ImageLabModelEntry,
  code: ImageLabFailureLogCode
): void {
  console.error(`[image-lab] ${entry.id} failed: ${code}`);
}

function failProvider(
  entry: ImageLabModelEntry,
  detail: ImageLabFailureDetail
): NormalizedImageResult {
  logFailure(entry, detail);
  return { kind: "provider_error", detail };
}

function failTimeout(
  entry: ImageLabModelEntry,
  cause: ImageLabTimeoutCause
): NormalizedImageResult {
  logFailure(entry, cause);
  return { kind: "timeout", cause };
}

function failRateLimited(entry: ImageLabModelEntry): NormalizedImageResult {
  logFailure(entry, "rate_limited");
  return { kind: "rate_limited" };
}

function failSafety(
  entry: ImageLabModelEntry,
  reason: ImageLabSafetyReason
): NormalizedImageResult {
  logFailure(entry, "safety_blocked");
  return { kind: "safety_blocked", reason };
}
