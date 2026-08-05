import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayRateLimitError,
  GatewayResponseError,
} from "@ai-sdk/gateway";
import { APICallError, NoImageGeneratedError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_LAB_ACCEPTED_MIME_TYPES,
  IMAGE_LAB_FAILURE_REASONS,
  IMAGE_LAB_MAX_OBJECT_BYTES,
  isImageLabFailureReason,
} from "../image-lab-rules";
import {
  failureReasonForResult,
  IMAGE_LAB_MIN_IMAGE_BYTES,
  IMAGE_LAB_PROVIDER_ERROR_DETAILS,
  IMAGE_LAB_SAFETY_REASONS,
  isBilledOutcome,
  sniffImageType,
  type ImageLabFailureDetail,
  type NormalizedImageResult,
} from "../image-model-rules";
import {
  generateLabImage,
  isImageLabLive,
  type ImageLabGenerateImageFn,
  type ImageLabGenerateTextFn,
  type ImageModelDeps,
} from "../image-model";
import { findModelEntry, IMAGE_LAB_MODELS } from "../model-registry";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Real magic bytes, because the sniff is this feature's security boundary and a
// fixture of `new Uint8Array([1,2,3])` labelled "a PNG" would let a broken sniff
// pass while proving nothing.

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const pad = (head: number[], length = 128): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set(head, 0);
  return bytes;
};

const PNG = pad(PNG_HEAD);
const PNG_2 = pad([...PNG_HEAD, 0x11, 0x22]); // a distinguishable second image
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
// "RIFF" + a 4-byte little-endian size + "WEBP".
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
// "RIFF" without "WEBP" at offset 8 — an AVI/WAV container. A prefix-only check
// would call this an image.
const RIFF_NOT_WEBP = pad([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
// "<svg xmlns=" — an executable document on the storage origin.
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const HTML = new TextEncoder().encode("<!DOCTYPE html><html><body>error</body></html>");
// A bare PNG signature with no IHDR: passes the sniff, is not an image.
const TINY_PNG = new Uint8Array(PNG_HEAD);
const OVERSIZE_PNG = pad(PNG_HEAD, IMAGE_LAB_MAX_OBJECT_BYTES + 1);

/** The exact string that must never reach a stored failure detail or a log. */
const CHILD_PROMPT =
  "Draw Maya Alvarez selling her lemonade at 42 Oak Street to her neighbour Mr Ruiz";

/**
 * A child whose PRODUCT contains the word "safety". This is the finding that
 * made free-text classification untenable: the vendor echoes the prompt into the
 * error body, so every unrelated 500 for this child used to classify as a safety
 * block — unbilled, dropped from the keep-rate denominator, with staff told to
 * reword a prompt that was never the problem.
 */
const SAFETY_WORD_PROMPT = "Draw a bright poster for Ben's Bike Safety Kits";

const file = (bytes: Uint8Array, mediaType = "image/png") => ({
  uint8Array: bytes,
  mediaType,
});

/**
 * Deps factory. `isLive` defaults to ON so each test states only the thing it is
 * testing — and so a test that means to exercise the OFF path has to say so,
 * which is what makes "no generator call was made" a real assertion.
 */
function deps(over: Partial<ImageModelDeps> = {}): ImageModelDeps & {
  imageCalls: Parameters<ImageLabGenerateImageFn>[0][];
  textCalls: Parameters<ImageLabGenerateTextFn>[0][];
  timeoutRequests: number[];
} {
  const imageCalls: Parameters<ImageLabGenerateImageFn>[0][] = [];
  const textCalls: Parameters<ImageLabGenerateTextFn>[0][] = [];
  const timeoutRequests: number[] = [];
  return {
    isLive: () => true,
    timeoutSignal: (ms) => {
      timeoutRequests.push(ms);
      return AbortSignal.timeout(ms);
    },
    generateImage: async (options) => {
      imageCalls.push(options);
      return { images: [file(PNG)], providerMetadata: undefined };
    },
    generateText: async (options) => {
      textCalls.push(options);
      return {
        files: [file(PNG)],
        finishReason: "stop",
        rawFinishReason: "STOP",
        providerMetadata: undefined,
      };
    },
    ...over,
    imageCalls,
    textCalls,
    timeoutRequests,
  };
}

const GEN_IMAGE_MODEL = "gpt-image-2";
const MULTIMODAL_MODEL = "gemini-3-pro-image";

/** Reject as the SDK does when the composed abort signal fires. */
const hangUntilAborted =
  <T,>() =>
  (options: { abortSignal: AbortSignal }): Promise<T> =>
    new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener("abort", () =>
        reject(options.abortSignal.reason)
      );
    });

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── The union ↔ schema mapping, and billing ──────────────────────────────────

describe("image-model: the result union maps 1:1 onto the schema's failure reasons", () => {
  // The union is a TS artifact; IMAGE_LAB_FAILURE_REASONS is mirrored into a
  // Postgres CHECK constraint. A member added on one side only surfaces at the
  // finalize write, in production, after a paid call.
  const samples: NormalizedImageResult[] = [
    { kind: "generated", bytes: PNG, contentType: "image/png", gatewayGenerationId: null, costReportedUsd: null },
    { kind: "safety_blocked", reason: IMAGE_LAB_SAFETY_REASONS.generic },
    { kind: "timeout", cause: "adapter_timeout" },
    { kind: "rate_limited" },
    { kind: "provider_error", detail: "unknown_error" },
    { kind: "unconfigured" },
  ];

  it.each(samples.map((s) => [s.kind, s] as const))(
    "%s maps to a real IMAGE_LAB_FAILURE_REASON (or null for success)",
    (kind, result: NormalizedImageResult) => {
      const reason = failureReasonForResult(result);
      if (kind === "generated") {
        expect(reason).toBeNull();
      } else {
        expect(reason).toBe(kind);
        expect(isImageLabFailureReason(reason)).toBe(true);
      }
    }
  );

  it("every schema failure reason is reachable — neither side has a spare", () => {
    const produced = samples
      .map(failureReasonForResult)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    expect([...produced].sort()).toEqual([...IMAGE_LAB_FAILURE_REASONS].sort());
  });
});

describe("image-model: billed-ness is decided for EVERY member of the union", () => {
  // Vendors bill on GENERATION, not on delivery. The three outcomes that used to
  // be reported unbilled but are not — no_image_returned and the two byte-level
  // rejections — are all 200-level answers: the model ran and the meter ran, and
  // the payload was only then found unusable by US.
  const expectations: [string, NormalizedImageResult, boolean][] = [
    ["generated", { kind: "generated", bytes: PNG, contentType: "image/png", gatewayGenerationId: null, costReportedUsd: null }, true],
    ["adapter timeout (vendor kept working)", { kind: "timeout", cause: "adapter_timeout" }, true],
    ["caller abort (we hung up on ourselves)", { kind: "timeout", cause: "caller_aborted" }, false],
    ["safety_blocked", { kind: "safety_blocked", reason: IMAGE_LAB_SAFETY_REASONS.generic }, false],
    ["rate_limited", { kind: "rate_limited" }, false],
    ["unconfigured", { kind: "unconfigured" }, false],
    // …and every provider_error detail individually, which is the member that
    // previously carried no billed assertion at all.
    ["no_image_returned", { kind: "provider_error", detail: "no_image_returned" }, true],
    ["unreadable_image_bytes", { kind: "provider_error", detail: "unreadable_image_bytes" }, true],
    ["implausible_image_bytes", { kind: "provider_error", detail: "implausible_image_bytes" }, true],
    ["oversize_image_bytes", { kind: "provider_error", detail: "oversize_image_bytes" }, true],
    ["unsupported_quality_tier", { kind: "provider_error", detail: "unsupported_quality_tier" }, false],
    ["api_error", { kind: "provider_error", detail: "api_error" }, false],
    ["api_error:503", { kind: "provider_error", detail: "api_error:503" }, false],
    ["unknown_error", { kind: "provider_error", detail: "unknown_error" }, false],
  ];

  it.each(expectations)("%s", (_label, result, billed) => {
    expect(isBilledOutcome(result)).toBe(billed);
  });

  it("leaves no provider_error detail unclassified", () => {
    // Adding a detail to the closed set without deciding whether it bills would
    // otherwise default it to "free" and quietly understate spend.
    const asserted = new Set(
      expectations
        .map(([, result]) => (result.kind === "provider_error" ? result.detail : null))
        .filter((detail): detail is ImageLabFailureDetail => detail !== null)
    );
    for (const detail of IMAGE_LAB_PROVIDER_ERROR_DETAILS) {
      expect(asserted.has(detail), detail).toBe(true);
    }
  });
});

// ── Magic-byte sniffing ──────────────────────────────────────────────────────

describe("image-model: magic-byte sniffing is the only source of content type", () => {
  it.each([
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [WEBP, "image/webp"],
  ] as const)("recognises the accepted type from its own bytes", (bytes, expected) => {
    expect(sniffImageType(bytes)).toBe(expected);
  });

  it("every type the sniff can produce is a type the bucket accepts", () => {
    // A sniff that admitted image/gif would pin a content type the storage put
    // then rejects, turning a good paid generation into an opaque upload failure.
    for (const bytes of [PNG, JPEG, WEBP]) {
      expect(IMAGE_LAB_ACCEPTED_MIME_TYPES).toContain(sniffImageType(bytes)!);
    }
  });

  it.each([
    ["SVG", SVG],
    ["HTML", HTML],
    ["RIFF that is not WEBP", RIFF_NOT_WEBP],
    ["empty", new Uint8Array()],
    ["a truncated PNG signature", new Uint8Array([0x89, 0x50, 0x4e])],
  ] as const)("refuses %s", (_label, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });
});

// ── Gating ───────────────────────────────────────────────────────────────────

describe("image-model: IMAGE_LAB_LIVE gates generation", () => {
  it("returns unconfigured and makes NO generator call when the flag is off", async () => {
    const d = deps({ isLive: () => false });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result).toEqual({ kind: "unconfigured" });
    expect(d.imageCalls).toHaveLength(0);
    expect(d.textCalls).toHaveLength(0);
    // The routine off-state is not a fault and must not log once per cell.
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(["", "false", "0", "no", "off", "TRUE-ish"])("IMAGE_LAB_LIVE=%s reads as OFF", (value) => {
    // A plain truthiness check reads "false" and "0" as ON — the two ways an
    // operator says "off" in a dashboard.
    vi.stubEnv("IMAGE_LAB_LIVE", value);
    expect(isImageLabLive()).toBe(false);
  });

  it.each(["1", "true", "TRUE", " true "])("IMAGE_LAB_LIVE=%s reads as ON", (value) => {
    vi.stubEnv("IMAGE_LAB_LIVE", value);
    expect(isImageLabLive()).toBe(true);
  });

  it("a GENUINELY UNSET flag reads as OFF and reaches no model", async () => {
    // Deleted, not stubbed to "": an absent variable is the PRODUCTION default,
    // and it takes a different branch (`undefined?.trim()`) from an empty string.
    const original = process.env.IMAGE_LAB_LIVE;
    delete process.env.IMAGE_LAB_LIVE;
    try {
      expect(process.env.IMAGE_LAB_LIVE).toBeUndefined();
      expect(isImageLabLive()).toBe(false);
      const d = deps();
      delete (d as { isLive?: unknown }).isLive; // fall through to the real reader
      const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
      expect(result).toEqual({ kind: "unconfigured" });
      expect(d.imageCalls).toHaveLength(0);
    } finally {
      if (original !== undefined) process.env.IMAGE_LAB_LIVE = original;
    }
  });

  it("an unknown model id fails closed to unconfigured, before any call", async () => {
    const d = deps();
    const result = await generateLabImage({ modelId: "gpt-image-9", prompt: CHILD_PROMPT }, d);
    expect(result).toEqual({ kind: "unconfigured" });
    expect(d.imageCalls).toHaveLength(0);
    expect(d.textCalls).toHaveLength(0);
  });
});

// ── Dialling ─────────────────────────────────────────────────────────────────

describe("image-model: what actually reaches the wire", () => {
  it("dials the gateway string with maxRetries 0 and n 1", async () => {
    const d = deps();
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    const call = d.imageCalls[0]!;
    expect(call.model).toBe("openai/gpt-image-2");
    // The retry policy is OURS. The SDK default of 2 internal retries would turn
    // one staff click into three PAID generations.
    expect(call.maxRetries).toBe(0);
    expect(call.n).toBe(1);
  });

  it.each(IMAGE_LAB_MODELS.map((entry) => [entry.id, entry.timeoutMs] as const))(
    "%s asks for a timeout of exactly its own registry timeoutMs (%i)",
    async (id, timeoutMs) => {
      // Pinned to the NUMBER, not to `expect.any(AbortSignal)`: the weaker
      // assertion stays green if every entry's timeout is swapped, which is the
      // one change that decides whether the function is killed mid-generation.
      const d = deps();
      await generateLabImage({ modelId: id, prompt: CHILD_PROMPT }, d);
      expect(d.timeoutRequests).toEqual([timeoutMs]);
    }
  );

  it("sends a bare string prompt when there are no references", async () => {
    // Reference carriage through the gateway is this entry's OPEN verify item,
    // so the no-reference call stays on the shape the model certainly supports.
    const d = deps();
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    expect(d.imageCalls[0]!.prompt).toBe(CHILD_PROMPT);
  });

  it("trims references to the model's limit rather than refusing the cell", async () => {
    // A compare run fans the IDENTICAL input at models whose limits differ
    // (4 / 11 / 14). Refusing would let the most restrictive model decide how
    // many references the whole drill may use.
    const d = deps();
    const refs = Array.from({ length: 9 }, () => ({ bytes: PNG, contentType: "image/png" as const }));
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, referenceImages: refs }, d);
    const prompt = d.imageCalls[0]!.prompt as { images: Uint8Array[]; text?: string };
    expect(prompt.images).toHaveLength(findModelEntry(GEN_IMAGE_MODEL)!.refImageLimit);
    expect(prompt.text).toBe(CHILD_PROMPT);
  });

  it("carries reference images as file parts alongside the prompt text", async () => {
    const d = deps();
    await generateLabImage(
      {
        modelId: MULTIMODAL_MODEL,
        prompt: CHILD_PROMPT,
        referenceImages: [{ bytes: JPEG, contentType: "image/jpeg" }],
      },
      d
    );
    const content = d.textCalls[0]!.messages[0]!.content;
    expect(content[0]).toEqual({ type: "text", text: CHILD_PROMPT });
    expect(content[1]).toEqual({ type: "file", data: JPEG, mediaType: "image/jpeg" });
  });

  it("forwards the registry's response-modality provider options", async () => {
    // Without an explicit IMAGE modality the model may answer a picture request
    // with prose: a billed call, zero files, and a provider_error that reads like
    // a gateway fault.
    const d = deps();
    await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(d.textCalls[0]!.providerOptions?.google?.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(d.textCalls[0]!.maxRetries).toBe(0);
  });

  it("REGRESSION: mutating the forwarded provider options cannot corrupt the registry", async () => {
    // The registry is module-level and outlives every request in a warm
    // serverless instance. Handing the SAME object to an SDK that normalizes in
    // place would let one call permanently change every later call's modality.
    const d = deps();
    await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    (d.textCalls[0]!.providerOptions!.google!.responseModalities as string[]).length = 0;
    await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(d.textCalls[1]!.providerOptions?.google?.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });
});

// ── Quality tiers ────────────────────────────────────────────────────────────

describe("image-model: an unpriced quality tier is REFUSED, never dialled", () => {
  it("passes a listed tier through as an OpenAI provider option", async () => {
    const d = deps();
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, quality: "high" }, d);
    expect(d.imageCalls[0]!.providerOptions?.openai?.quality).toBe("high");
  });

  it("refuses an unlisted tier WITHOUT making a call", async () => {
    // Ignoring it (the old behaviour) ran at the VENDOR's default — OpenAI's
    // `auto`, which may pick `high` at $0.211, 35× low — while estimatedCostUsd
    // returned null, so the single priciest run in the table contributed zero
    // cost evidence to the decision the Lab exists to make.
    const d = deps();
    const result = await generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, quality: "ultra" },
      d
    );
    expect(result).toEqual({ kind: "provider_error", detail: "unsupported_quality_tier" });
    expect(d.imageCalls).toHaveLength(0);
    expect(isBilledOutcome(result)).toBe(false);
  });

  it("refuses a tier the multimodal models do not price either", async () => {
    const d = deps();
    const result = await generateLabImage(
      { modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT, quality: "high" },
      d
    );
    expect(result).toEqual({ kind: "provider_error", detail: "unsupported_quality_tier" });
    expect(d.textCalls).toHaveLength(0);
  });

  it("never sends a PRICE LABEL as a wire value", async () => {
    // "standard" is our single-tier pricing key, not an OpenAI enum value.
    // Deriving the wire value from the price map would 400 every call on any
    // single-tier OpenAI model added later.
    const d = deps();
    await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT, quality: "standard" }, d);
    const options = d.textCalls[0]!.providerOptions;
    expect(JSON.stringify(options ?? {})).not.toContain("standard");
  });
});

// ── File selection, shared by both legs ──────────────────────────────────────

describe("image-model: ONE file picker, used by both legs", () => {
  const imageLeg = (files: ReturnType<typeof file>[]) =>
    generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT },
      deps({ generateImage: async () => ({ images: files }) })
    );
  const textLeg = (files: ReturnType<typeof file>[]) =>
    generateLabImage(
      { modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT },
      deps({ generateText: async () => ({ files, finishReason: "stop" }) })
    );
  const legs = [
    ["generateImage", imageLeg],
    ["multimodal", textLeg],
  ] as const;

  it.each(legs)("%s: reads its own result field and sniffs the bytes", async (_leg, run) => {
    // The multimodal half is the easy mistake: generateText has no `images`, so
    // a copy of the other path would report "no image" against a BILLED call.
    const result = await run([file(WEBP, "application/octet-stream")]);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    // The vendor DECLARED octet-stream; the bytes are a WebP. The sniff wins.
    expect(result.contentType).toBe("image/webp");
  });

  it.each(legs)("%s: skips an empty first element", async (_leg, run) => {
    const result = await run([file(new Uint8Array(), "image/png"), file(PNG)]);
    expect(result.kind).toBe("generated");
  });

  it.each(legs)("%s: skips a NON-IMAGE first element rather than failing on it", async (_leg, run) => {
    // The old multimodal leg took the first non-empty file without sniffing, so
    // a companion text/JSON part in position 0 became "the image" and the whole
    // paid generation was thrown away as unreadable.
    const result = await run([file(HTML, "image/png"), file(JPEG)]);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.contentType).toBe("image/jpeg");
  });

  it.each(legs)("%s: with MULTIPLE images keeps the LAST one", async (_leg, run) => {
    // gemini-3-pro-image is a THINKING model: it emits interim draft images
    // before the final one. Taking index 0 stores and scores a DRAFT while
    // paying for the final — quietly corrupting the comparison itself.
    const result = await run([file(PNG), file(PNG_2)]);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.bytes).toBe(PNG_2);
  });

  it.each(legs)("%s: zero files is no_image_returned — and IS billed", async (_leg, run) => {
    // The registry documents this exact outcome for a missing response modality:
    // "a billed call and zero files". Reporting it unbilled understates spend on
    // precisely the failure worth chasing.
    const result = await run([]);
    expect(result).toEqual({ kind: "provider_error", detail: "no_image_returned" });
    expect(isBilledOutcome(result)).toBe(true);
  });

  it.each(legs)("%s: bytes that fail the sniff are rejected and claim NO type", async (_leg, run) => {
    const result = await run([file(SVG, "image/png")]);
    expect(result).toEqual({ kind: "provider_error", detail: "unreadable_image_bytes" });
    // No contentType and no bytes exist on this branch at all — there is nothing
    // for a storage put to pin, which is the point: it is never stored.
    expect(result).not.toHaveProperty("contentType");
    expect(result).not.toHaveProperty("bytes");
    expect(isBilledOutcome(result)).toBe(true);
  });

  it.each(legs)("%s: an implausibly tiny payload is refused despite passing the sniff", async (_leg, run) => {
    // An 8-byte PNG signature with no IHDR SNIFFS AS A PNG. Without a floor it is
    // stored, billed, served as a broken image, and counted in the keep-rate
    // denominator as a success.
    expect(sniffImageType(TINY_PNG)).toBe("image/png");
    expect(TINY_PNG.length).toBeLessThan(IMAGE_LAB_MIN_IMAGE_BYTES);
    const result = await run([file(TINY_PNG)]);
    expect(result).toEqual({ kind: "provider_error", detail: "implausible_image_bytes" });
  });

  it.each(legs)("%s: a payload over the bucket ceiling is refused before the put", async (_leg, run) => {
    // The ceiling is Unit 1's, mirrored in the bucket. Checked HERE so oversize
    // is a recorded outcome rather than an opaque storage error after the money
    // is already spent.
    expect(OVERSIZE_PNG.length).toBeGreaterThan(IMAGE_LAB_MAX_OBJECT_BYTES);
    const result = await run([file(OVERSIZE_PNG)]);
    expect(result).toEqual({ kind: "provider_error", detail: "oversize_image_bytes" });
    expect(isBilledOutcome(result)).toBe(true);
  });
});

describe("image-model: PATH PARITY — equivalent responses normalize identically", () => {
  // The two legs read different response fields, so nothing but a test stops
  // them drifting into different verdicts on the same vendor behaviour.
  const shapes: [string, ReturnType<typeof file>[]][] = [
    ["empty first element", [file(new Uint8Array()), file(PNG)]],
    ["multiple images", [file(PNG), file(PNG_2)]],
    ["prose only (no files)", []],
    ["unreadable bytes", [file(HTML)]],
    ["tiny payload", [file(TINY_PNG)]],
  ];

  it.each(shapes)("%s produces the same result on both legs", async (_label, files) => {
    const viaImages = await generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT },
      deps({ generateImage: async () => ({ images: files }) })
    );
    const viaFiles = await generateLabImage(
      { modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT },
      deps({ generateText: async () => ({ files, finishReason: "stop" }) })
    );
    expect(viaImages).toEqual(viaFiles);
    expect(isBilledOutcome(viaImages)).toBe(isBilledOutcome(viaFiles));
  });
});

// ── Gateway error classification ─────────────────────────────────────────────

describe("image-model: GATEWAY errors classify (they are not APICallError)", () => {
  // ⚠ THE BUG THIS PINS: @ai-sdk/gateway funnels every vendor failure through
  // `asGatewayError`, which returns a GatewayError subclass. `GatewayError
  // extends Error` and carries NO APICallError marker, so classifying on
  // `APICallError.isInstance` alone made `rate_limited` dead code, never emitted
  // `api_error:<status>`, and turned every real production failure into
  // `unknown_error`. These are REAL subclass instances, not look-alikes.
  const throwing = (err: unknown) => async () => {
    throw err;
  };

  it("GatewayRateLimitError → rate_limited", async () => {
    const d = deps({ generateImage: throwing(new GatewayRateLimitError({ message: "slow down", statusCode: 429 })) });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result).toEqual({ kind: "rate_limited" });
  });

  it("classifies a rate limit from the gateway TYPE even without a 429 status", async () => {
    // The `type` field is the gateway's own discriminator and is the stable
    // signal; the status is a secondary confirmation.
    const err = new GatewayRateLimitError({ message: "slow down", statusCode: 200 });
    expect(err.type).toBe("rate_limit_exceeded");
    const d = deps({ generateImage: throwing(err) });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "rate_limited",
    });
  });

  it.each([
    [new GatewayInternalServerError({ message: "boom", statusCode: 500 }), "api_error:500"],
    [new GatewayAuthenticationError({ message: "no key", statusCode: 401 }), "api_error:401"],
    [new GatewayInvalidRequestError({ message: "bad body", statusCode: 400 }), "api_error:400"],
    [new GatewayResponseError({ message: "unparseable", statusCode: 502 }), "api_error:502"],
  ] as const)("$1 carries only the status digits", async (err, detail) => {
    const d = deps({ generateImage: throwing(err) });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "provider_error",
      detail,
    });
  });

  it("still classifies a bare APICallError (the pre-gateway shape)", async () => {
    const d = deps({
      generateImage: throwing(
        new APICallError({ message: "upstream exploded", url: "https://gw.example/v1", requestBodyValues: {}, statusCode: 503 })
      ),
    });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "provider_error",
      detail: "api_error:503",
    });
  });

  it("a 429 APICallError is still rate_limited", async () => {
    const d = deps({
      generateImage: throwing(
        new APICallError({ message: "Too Many Requests", url: "https://gw.example/v1", requestBodyValues: {}, statusCode: 429 })
      ),
    });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "rate_limited",
    });
  });

  it("NoImageGeneratedError becomes provider_error/no_image_returned", async () => {
    const d = deps({ generateImage: throwing(new NoImageGeneratedError({ message: "no image" })) });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "provider_error",
      detail: "no_image_returned",
    });
  });

  it("an arbitrary throw becomes provider_error/unknown_error", async () => {
    // Nothing escapes: the caller finalizes a row on EVERY path, so one model's
    // failure never blanks a run (origin R3).
    const d = deps({ generateImage: throwing("a bare string") });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "provider_error",
      detail: "unknown_error",
    });
  });
});

// ── Timeouts and cancellation ────────────────────────────────────────────────

describe("image-model: a FIRED timeout is classified from the signal", () => {
  it("a real AbortSignal.timeout firing yields timeout/adapter_timeout — and IS billed", async () => {
    // ⚠ THE BUG THIS PINS: AbortSignal.timeout rejects with a DOMException named
    // "TimeoutError" that has no `.code`, so the gateway's own timeout detection
    // misses it and re-wraps it as GatewayResponseError (name
    // "GatewayResponseError"). Matching on the thrown error's NAME therefore
    // failed exactly here, and the most expensive outcome on the priciest model
    // was recorded as unbilled. This uses a REAL timeout signal that really
    // fires, not a hand-named Error.
    const d = deps({
      timeoutSignal: () => AbortSignal.timeout(5),
      generateImage: hangUntilAborted(),
    });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result).toEqual({ kind: "timeout", cause: "adapter_timeout" });
    expect(failureReasonForResult(result)).toBe("timeout");
    expect(isBilledOutcome(result)).toBe(true);
  });

  it("survives the gateway RE-WRAPPING that abort as a GatewayResponseError", async () => {
    // The precise production shape: our signal fired, and what surfaced is a
    // gateway 500 whose name says nothing about a timeout.
    const d = deps({
      timeoutSignal: () => AbortSignal.timeout(5),
      generateImage: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () =>
            reject(new GatewayResponseError({ message: "Gateway request failed", statusCode: 500 }))
          );
        }),
    });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result).toEqual({ kind: "timeout", cause: "adapter_timeout" });
  });

  it.each(["TimeoutError", "AbortError"])(
    "still recognises a bare %s when no signal fired (belt and braces)",
    async (name) => {
      const err = new Error("aborted");
      err.name = name;
      const d = deps({ generateText: async () => { throw err; } });
      expect(await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
        kind: "timeout",
        cause: "adapter_timeout",
      });
    }
  );
});

describe("image-model: a caller's abort is distinguishable from a vendor timeout", () => {
  it("an already-aborted caller signal never dials at all", async () => {
    const d = deps({ abortSignal: undefined } as Partial<ImageModelDeps>);
    const result = await generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, abortSignal: AbortSignal.abort() },
      d
    );
    expect(result).toEqual({ kind: "timeout", cause: "caller_aborted" });
    expect(d.imageCalls).toHaveLength(0);
    expect(isBilledOutcome(result)).toBe(false);
  });

  it("an abort MID-FLIGHT is caller_aborted, not an adapter timeout — and does not bill", async () => {
    // Without the distinction, a compare fan cancelling eleven siblings, or a
    // route enforcing its residual budget, would bill the staff member for every
    // run they themselves cancelled.
    const controller = new AbortController();
    const d = deps({
      generateImage: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason));
          controller.abort();
        }),
    });
    const result = await generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, abortSignal: controller.signal },
      d
    );
    expect(result).toEqual({ kind: "timeout", cause: "caller_aborted" });
    expect(isBilledOutcome(result)).toBe(false);
    // Both still file under the schema's single `timeout` reason.
    expect(failureReasonForResult(result)).toBe("timeout");
  });

  it("composes the caller's signal WITH the model timeout rather than replacing it", async () => {
    const controller = new AbortController();
    const d = deps();
    await generateLabImage(
      { modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT, abortSignal: controller.signal },
      d
    );
    // The model's own timeout was still requested — a caller signal must not
    // silently remove the ceiling that keeps the invocation inside its budget.
    expect(d.timeoutRequests).toEqual([findModelEntry(GEN_IMAGE_MODEL)!.timeoutMs]);
    const passed = d.imageCalls[0]!.abortSignal;
    expect(passed.aborted).toBe(false);
    controller.abort();
    expect(passed.aborted).toBe(true);
  });
});

// ── Safety classification ────────────────────────────────────────────────────

describe("image-model: safety blocks classify from STRUCTURE, never from prose", () => {
  it("a PROHIBITED_CONTENT finish on a Gemini model names the allowlist", async () => {
    // The reason has to be ACTIONABLE: this is not a prompt problem, it is a
    // pending allowlist request, and it blocks every hero prompt until granted.
    const d = deps({
      generateText: async () => ({ files: [], finishReason: "other", rawFinishReason: "PROHIBITED_CONTENT" }),
    });
    expect(await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "safety_blocked",
      reason: IMAGE_LAB_SAFETY_REASONS.personGeneration,
    });
  });

  it("the SDK's unified `content-filter` finish is enough on its own", async () => {
    const d = deps({ generateText: async () => ({ files: [], finishReason: "content-filter" }) });
    const result = await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result.kind).toBe("safety_blocked");
  });

  it("the finish reason is read BEFORE the files — a block is never 'zero files'", async () => {
    // Order matters for the EVIDENCE: the keep-rate denominator excludes safety
    // blocks. A block mis-filed as provider_error would land back in that
    // denominator and make the Gemini models look bad for a reason that is our
    // paperwork, not their output.
    const d = deps({
      generateText: async () => ({ files: [], finishReason: "other", rawFinishReason: "IMAGE_SAFETY" }),
    });
    const result = await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(failureReasonForResult(result)).toBe("safety_blocked");
    expect(isBilledOutcome(result)).toBe(false);
  });

  it("a STRUCTURED vendor safety code in the error body becomes safety_blocked", async () => {
    const d = deps({
      generateText: async () => {
        throw new APICallError({
          message: "Request rejected",
          url: "https://gw.example/v1",
          requestBodyValues: {},
          statusCode: 400,
          responseBody: JSON.stringify({ error: { code: "content_policy_violation", message: "…" } }),
        });
      },
    });
    const result = await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(result.kind).toBe("safety_blocked");
  });

  it("an OpenAI block does NOT blame the Gemini allowlist", async () => {
    // Sending staff to chase a Google allowlist for an OpenAI refusal wastes the
    // one action the message exists to prompt.
    const d = deps({
      generateImage: async () => {
        throw new APICallError({
          message: "Request rejected",
          url: "https://gw.example/v1",
          requestBodyValues: {},
          statusCode: 400,
          responseBody: JSON.stringify({ error: { code: "content_policy_violation" } }),
        });
      },
    });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "safety_blocked",
      reason: IMAGE_LAB_SAFETY_REASONS.generic,
    });
  });

  // ── The two negatives that motivated the rewrite ───────────────────────────

  it("a 500 whose MESSAGE says 'upstream blocked' is provider_error, not safety", async () => {
    // /BLOCKED/i over free text also matched ordinary account errors ("API key
    // has been blocked"), converting infrastructure faults into "reword your
    // prompt" and dropping them out of the keep-rate denominator.
    const d = deps({
      generateImage: async () => {
        throw new APICallError({
          message: "upstream blocked",
          url: "https://gw.example/v1",
          requestBodyValues: {},
          statusCode: 500,
        });
      },
    });
    expect(await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d)).toEqual({
      kind: "provider_error",
      detail: "api_error:500",
    });
  });

  it("a body ECHOING a prompt that contains the word 'safety' is provider_error", async () => {
    // ⚠ THE BUG THIS PINS: vendor bodies echo the prompt, and the prompt is
    // child-authored business text. A child selling "Bike Safety Kits" had EVERY
    // unrelated 500 classified as a safety block — recorded unbilled, excluded
    // from the keep-rate denominator, and reported to staff as a prompt problem.
    const d = deps({
      generateImage: async () => {
        throw new APICallError({
          message: `Internal error processing: ${SAFETY_WORD_PROMPT}`,
          url: "https://gw.example/v1",
          requestBodyValues: { prompt: SAFETY_WORD_PROMPT },
          statusCode: 500,
          responseBody: JSON.stringify({
            error: { message: `Failed on prompt: ${SAFETY_WORD_PROMPT}`, type: "server_error" },
          }),
        });
      },
    });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: SAFETY_WORD_PROMPT }, d);
    expect(result).toEqual({ kind: "provider_error", detail: "api_error:500" });
    // …and it bills as the infrastructure failure it is, not as a free refusal.
    expect(failureReasonForResult(result)).toBe("provider_error");
  });
});

// ── The prompt never leaks ───────────────────────────────────────────────────

describe("image-model: REGRESSION — no failure detail or log ever carries the prompt", () => {
  // WHY THIS IS A REGRESSION TEST AND NOT A CODE COMMENT: safety-block responses
  // conventionally QUOTE THE OFFENDING PROMPT BACK, and this prompt is built from
  // child-authored business content (a first-person pitch conventionally opens
  // with the child's own name). Echoing the vendor message into failure_detail
  // would copy that content into a second DB column and into every log line that
  // ever prints the row — creating a copy nobody knows to purge when a family
  // revokes consent.
  const echoes = [
    () =>
      new APICallError({
        message: `Your request was rejected. Prompt: "${CHILD_PROMPT}"`,
        url: "https://gw.example/v1",
        requestBodyValues: { prompt: CHILD_PROMPT },
        statusCode: 400,
        responseBody: JSON.stringify({ error: { message: CHILD_PROMPT, code: "content_policy_violation" } }),
      }),
    () => new GatewayInvalidRequestError({ message: `rejected: ${CHILD_PROMPT}`, statusCode: 400 }),
    () => new Error(`failed generating: ${CHILD_PROMPT}`),
    () => new NoImageGeneratedError({ message: CHILD_PROMPT }),
  ];

  it.each(echoes.map((make, i) => [i, make] as const))(
    "vendor error #%i quoting the prompt yields a detail free of it",
    async (_i, make) => {
      const d = deps({ generateImage: async () => { throw make(); } });
      const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(CHILD_PROMPT);
      expect(serialized).not.toContain("Maya");
      expect(serialized).not.toContain("Oak Street");
      // …and neither does anything printed to the operator log.
      for (const call of errorLog.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("Maya");
        expect(JSON.stringify(call)).not.toContain("Oak Street");
      }
    }
  );

  it("provider_error details are MEMBERS OF THE IMPORTED closed set", async () => {
    // Asserted against the constant, not a hand-copied regex: a regex in the test
    // is a second, drifting copy of the very list this is meant to police.
    const d = deps({
      generateImage: async () => {
        throw new APICallError({
          message: CHILD_PROMPT,
          url: "https://gw.example/v1",
          requestBodyValues: {},
          statusCode: 500,
        });
      },
    });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    if (result.kind !== "provider_error") throw new Error("expected provider_error");
    const [base, status, ...rest] = result.detail.split(":");
    expect(IMAGE_LAB_PROVIDER_ERROR_DETAILS).toContain(base);
    expect(rest).toHaveLength(0);
    // The ONLY variable part is digits, which cannot smuggle prompt text.
    if (status !== undefined) expect(status).toMatch(/^\d+$/);
  });

  it("safety reasons come from the closed set, never from the vendor's words", async () => {
    const d = deps({
      generateText: async () => ({
        files: [],
        finishReason: "content-filter",
        rawFinishReason: `PROHIBITED_CONTENT: "${CHILD_PROMPT}"`,
      }),
    });
    const result = await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    if (result.kind !== "safety_blocked") throw new Error("expected safety_blocked");
    expect(Object.values(IMAGE_LAB_SAFETY_REASONS)).toContain(result.reason);
    expect(result.reason).not.toContain(CHILD_PROMPT);
  });
});

// ── Operator logging ─────────────────────────────────────────────────────────

describe("image-model: EVERY failure branch logs exactly once, code only", () => {
  // The returned failures used to be silent: `no_image_returned` on both legs and
  // `unreadable_image_bytes` — the security boundary actually firing — produced
  // no operator signal at all, as did timeout and rate_limited.
  const branches: [string, Partial<ImageModelDeps>, string][] = [
    ["no_image_returned", { generateImage: async () => ({ images: [] }) }, "no_image_returned"],
    ["unreadable_image_bytes", { generateImage: async () => ({ images: [file(SVG)] }) }, "unreadable_image_bytes"],
    ["implausible_image_bytes", { generateImage: async () => ({ images: [file(TINY_PNG)] }) }, "implausible_image_bytes"],
    ["oversize_image_bytes", { generateImage: async () => ({ images: [file(OVERSIZE_PNG)] }) }, "oversize_image_bytes"],
    ["api_error", { generateImage: async () => { throw new GatewayInternalServerError({ message: "x", statusCode: 500 }); } }, "api_error:500"],
    ["rate_limited", { generateImage: async () => { throw new GatewayRateLimitError({ message: "x", statusCode: 429 }); } }, "rate_limited"],
    ["unknown_error", { generateImage: async () => { throw new Error("x"); } }, "unknown_error"],
    ["adapter_timeout", { timeoutSignal: () => AbortSignal.timeout(5), generateImage: hangUntilAborted() }, "adapter_timeout"],
  ];

  it.each(branches)("%s logs one line naming the model and the code", async (_label, over, code) => {
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, deps(over));
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0]![0]);
    expect(line).toContain(GEN_IMAGE_MODEL);
    expect(line).toContain(code);
    // Two facts and no more: no prompt, no vendor message, no bytes.
    expect(line).not.toContain(CHILD_PROMPT);
  });

  it("a safety block logs the code, never the vendor's explanation", async () => {
    const d = deps({
      generateText: async () => ({ files: [], finishReason: "other", rawFinishReason: `IMAGE_SAFETY ${CHILD_PROMPT}` }),
    });
    await generateLabImage({ modelId: MULTIMODAL_MODEL, prompt: CHILD_PROMPT }, d);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0]![0]);
    expect(line).toContain("safety_blocked");
    expect(line).not.toContain("Maya");
  });

  it("a SUCCESS logs nothing", async () => {
    await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, deps());
    expect(errorLog).not.toHaveBeenCalled();
  });
});

// ── Gateway observability ────────────────────────────────────────────────────

describe("image-model: gateway metadata is read defensively (cost parity is unverified)", () => {
  it("extracts generationId and cost when the gateway supplies them", async () => {
    const d = deps({
      generateImage: async () => ({
        images: [file(PNG)],
        providerMetadata: { gateway: { generationId: "gen_abc123", cost: 0.053 } },
      }),
    });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.gatewayGenerationId).toBe("gen_abc123");
    expect(result.costReportedUsd).toBeCloseTo(0.053, 6);
  });

  it.each([
    ["absent metadata", undefined],
    ["metadata without a gateway block", { openai: {} }],
    ["a gateway block with neither field", { gateway: {} }],
    ["a cost that arrived as a string", { gateway: { cost: "0.053" } }],
    ["an empty generationId", { gateway: { generationId: "" } }],
    ["a null gateway", { gateway: null }],
  ] as const)("%s yields nulls, not a crash and not an invented number", async (_label, meta) => {
    // Nulls are the EXPECTED case: image-modality parity for gateway cost
    // reporting is recorded UNVERIFIED in the registry. Coercing "0.053" would
    // silently invent evidence for the decision the Lab exists to make.
    const d = deps({ generateImage: async () => ({ images: [file(PNG)], providerMetadata: meta }) });
    const result = await generateLabImage({ modelId: GEN_IMAGE_MODEL, prompt: CHILD_PROMPT }, d);
    if (result.kind !== "generated") throw new Error("expected generated");
    expect(result.gatewayGenerationId).toBeNull();
    expect(result.costReportedUsd).toBeNull();
  });
});

// ── Every entry reaches its declared leg ─────────────────────────────────────

describe("image-model: every registry entry reaches its declared path", () => {
  it.each(IMAGE_LAB_MODELS.map((entry) => [entry.id, entry.path] as const))(
    "%s (%s) normalizes to generated",
    async (id, path) => {
      // A future entry whose `path` is wrong would dial the other leg, and on a
      // real call that means reading `result.images` off a generateText result —
      // undefined, reported as "no image", against a call that was billed.
      const d = deps();
      const result = await generateLabImage({ modelId: id, prompt: CHILD_PROMPT }, d);
      expect(result.kind).toBe("generated");
      expect(d.imageCalls).toHaveLength(path === "generateImage" ? 1 : 0);
      expect(d.textCalls).toHaveLength(path === "multimodal" ? 1 : 0);
    }
  );
});
