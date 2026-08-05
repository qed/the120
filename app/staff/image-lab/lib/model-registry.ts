/**
 * Image Lab — the model registry.
 *
 * PURE rules module: no next/supabase/ai imports, so the node suite can pin
 * every entry, bound and closed set here. The adapter (image-model.ts) is the
 * only module that talks to a vendor; this one only *describes* what may be
 * dialled. That split is the extensibility criterion: adding a fourth model is
 * an entry here plus at most provider glue there.
 *
 * ── Why a registry and not three `if` branches ─────────────────────────────
 * The three launch models do not agree on ANYTHING that matters: two different
 * SDK call shapes (`generateImage` vs multimodal `generateText`), price ranges
 * spanning 35×, latencies spanning 30×, reference-image limits spanning 3×, and
 * two different vendor data-use postures. Every one of those is data the UI
 * (price note, ref-limit counter, quality selector) AND the adapter (which call
 * to make, how long to wait) need. Held as branches they would be discovered
 * twice and drift; held here they are one table with one parity test.
 *
 * ── The `verified` block, and why it is IN THE CODE ────────────────────────
 * An unverified capability that lives only in a planning doc becomes, three
 * units later, an assumption nobody remembers making. So each entry carries an
 * explicit `verified` block recording status + how it was established. A reader
 * of a failing generate-cell can see, at the call site's data, that (say)
 * gateway cost reporting for image modality was never confirmed and a null
 * `costReportedUsd` is therefore expected rather than a bug.
 *
 * Statuses are deliberately only two. "confirmed" means checked against
 * something mechanical (the installed gateway catalog's types, the repo's own
 * config); "unverified" means it needs a real call or a vendor response, which
 * this module never makes.
 */

// ── Function-duration budget (the timeout arithmetic, done once) ─────────────

/**
 * The route budget every adapter timeout is sized under.
 *
 * DERIVED, NOT ASSUMED: `vercel.json` in this repo carries `crons` and NOTHING
 * else — no `functions` block, so no per-route `maxDuration` override exists
 * project-wide and the platform default applies (300s on Fluid Compute). The
 * `export const maxDuration = 60` on the FP cover route is that ROUTE's own
 * choice, not a project ceiling.
 */
export const IMAGE_LAB_ROUTE_BUDGET_MS = 300_000;

/**
 * Time reserved AFTER the vendor call returns, inside the same invocation: the
 * magic-byte sniff, the storage put of a multi-megabyte PNG, the row finalize,
 * and the audit breadcrumb. If the adapter is allowed to consume the whole
 * budget, the function is killed holding paid bytes it never stored — the worst
 * of both outcomes (billed, discarded, and recorded as a timeout).
 */
export const IMAGE_LAB_TIMEOUT_HEADROOM_MS = 20_000;

// ── Closed sets ──────────────────────────────────────────────────────────────

/**
 * The two SDK call shapes, which is the whole reason the adapter has two legs.
 * `generateImage` returns `result.images`; `multimodal` is `generateText` and
 * returns images in `result.files` (NOT `result.images` — a genuinely easy
 * mistake that yields "zero images" against a successful, billed call).
 */
export type ImageLabModelPath = "generateImage" | "multimodal";

export type ImageLabProvider = "openai" | "google";

/**
 * Provider options are a REQUEST BODY, not an arbitrary bag: the only values any
 * entry carries are a modality list and an injected quality string. Typing them
 * narrowly (rather than a recursive JSON type) makes a non-serializable value a
 * compile error at the entry instead of a runtime surprise on a paid call.
 */
export type ImageLabProviderOptionValue = string | readonly string[];

export type ImageLabProviderOptions = Readonly<
  Record<string, Readonly<Record<string, ImageLabProviderOptionValue>>>
>;

/**
 * Registry keys. Deliberately the bare model name, NOT the gateway string: the
 * key is what the DB's `model_id` column stores and what the UI passes around,
 * and it must survive a gateway re-route (a per-entry direct-vendor fallback)
 * without rewriting stored history.
 */
export const IMAGE_LAB_MODEL_IDS = [
  "gpt-image-2",
  "gemini-3-pro-image",
  "gemini-3.1-flash-lite-image",
] as const;
export type ImageLabModelId = (typeof IMAGE_LAB_MODEL_IDS)[number];

// ── Verification bookkeeping ─────────────────────────────────────────────────

export type VerificationStatus = "confirmed" | "unverified";

export type VerificationNote = {
  readonly status: VerificationStatus;
  /** How it was established, or what would establish it. Never a bare "TODO". */
  readonly note: string;
};

/**
 * The four verify-first items, one field each, per entry. They are per-entry
 * rather than global because the answers genuinely differ by model: gateway
 * routability is a catalog fact per id, the personGeneration allowlist binds
 * only the Gemini 3.x family, and reference-image input is the open scope
 * question for gpt-image-2 specifically.
 */
export type ImageLabVerification = {
  /** Can the gateway route this id at all? */
  readonly gatewayRoutable: VerificationNote;
  /** Can reference images be carried to this model on its path? */
  readonly referenceImageInput: VerificationNote;
  /** Does the gateway report cost for this model's modality? */
  readonly costReporting: VerificationNote;
  /** Is person/character output permitted without an allowlist grant? */
  readonly personGeneration: VerificationNote;
};

// ── The entry ────────────────────────────────────────────────────────────────

export type ImageLabModelEntry = {
  readonly id: ImageLabModelId;
  /** The gateway `"provider/model"` string. The ONLY vendor identifier. */
  readonly gatewayModel: string;
  readonly provider: ImageLabProvider;
  readonly path: ImageLabModelPath;
  /**
   * Per-IMAGE list price in USD, keyed by quality tier. Models with a single
   * tier use the sole key `"standard"`, so the cost estimate is one lookup
   * everywhere (see {@link estimatedCostUsd}).
   *
   * ⚠ THESE KEYS ARE OURS, NOT THE WIRE'S. `"standard"` is a pricing label; it
   * is NOT a value OpenAI's `quality` parameter accepts, and sending it would
   * 400 every call. What may go on the wire is {@link apiQualityValues}, kept
   * separate precisely so a pricing label can never be mistaken for an enum.
   *
   * LIST prices recorded 2026-08-05, used for the "estimated" column. The
   * "reported" column comes from the gateway and may stay null forever — see
   * `verified.costReporting`.
   */
  readonly priceNoteUsd: Readonly<Record<string, number>>;
  /** Key into {@link priceNoteUsd}; guaranteed present by a registry test. */
  readonly qualityDefault: string;
  /**
   * Tier keys this provider ACCEPTS as a wire value, if it takes one at all.
   * Absent means the model has no quality parameter and none is ever sent.
   */
  readonly apiQualityValues?: readonly string[];
  /**
   * The adapter's `AbortSignal.timeout`. Sized per model from its documented
   * worst case, always ≥ {@link IMAGE_LAB_TIMEOUT_HEADROOM_MS} under
   * {@link IMAGE_LAB_ROUTE_BUDGET_MS}.
   */
  readonly timeoutMs: number;
  /** Maximum reference images this model accepts on one call. Always ≥ 1. */
  readonly refImageLimit: number;
  /** Vendor training/retention posture (origin R12a). Shown in the UI. */
  readonly dataUseNote: string;
  /** Known operational limits a staff member must see BEFORE spending. */
  readonly restrictions?: readonly string[];
  /**
   * Provider-specific call options passed through verbatim by the adapter. The
   * "at most provider glue" escape hatch: a model needing a body parameter gets
   * it declared here rather than branched for in the adapter.
   */
  readonly providerOptions?: ImageLabProviderOptions;
  readonly verified: ImageLabVerification;
};

// ── Shared notes ─────────────────────────────────────────────────────────────

/**
 * ⚠ Applies to ALL Gemini 3.x image models. Without an allowlist grant,
 * person/character output comes back with `finishReason: PROHIBITED_CONTENT`
 * rather than an image — which the adapter maps to `safety_blocked` and the
 * keep-rate denominator excludes, precisely so a pending paperwork item does not
 * read as "this model is bad at heroes".
 */
const GEMINI_PERSON_GENERATION: VerificationNote = {
  status: "unverified",
  note:
    "personGeneration allowlist request is an operational task filed at build " +
    "start; until granted, person/character prompts return PROHIBITED_CONTENT " +
    "and normalize to safety_blocked. Verified by an allowlist grant, not by code.",
};

/**
 * Both entries claiming gateway routability claim it on the SAME mechanical
 * evidence, so the sentence lives once: the installed `@ai-sdk/gateway` catalog
 * types enumerate the id. That is stronger than a doc page (it ships with the
 * version we call) and weaker than a live 200 (a catalog entry is not a
 * successful request), which is why it reads "catalog" and not "live".
 */
const routableByCatalog = (union: string): VerificationNote => ({
  status: "confirmed",
  note:
    `Listed in the installed @ai-sdk/gateway ${union} union (v7 catalog, ` +
    `checked 2026-08-05). Not yet exercised by a live call.`,
});

/**
 * Image-modality cost parity is one open question with one answer, so it is also
 * written once. The gateway exposes `providerMetadata.gateway.generationId`, and
 * `GET /v1/generation` returns cost for that id — documented for TEXT
 * generations. Whether an image generation produces a generationId at all, let
 * alone a priced one, is unconfirmed.
 */
const COST_REPORTING_UNCONFIRMED: VerificationNote = {
  status: "unverified",
  note:
    "Gateway cost reporting (providerMetadata.gateway.generationId → GET " +
    "/v1/generation) is documented for text modality; image parity is " +
    "unconfirmed. A null costReportedUsd is EXPECTED, not a bug — the " +
    "estimated column carries the decision evidence.",
};

// ── Immutability ─────────────────────────────────────────────────────────────

/**
 * Freeze the table, all the way down.
 *
 * `readonly` is a COMPILE-TIME claim that is erased at runtime, and
 * {@link findModelEntry} hands out references into a module-level object that
 * outlives every request in a warm serverless instance. One `entry.timeoutMs =
 * 0` — or an SDK that normalizes an options object in place — would poison every
 * later request in that container, with no error and no way to reproduce it
 * locally. Freezing turns that into a TypeError at the mutation.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ── The registry ─────────────────────────────────────────────────────────────

const ENTRIES: readonly ImageLabModelEntry[] = deepFreeze([
  {
    id: "gpt-image-2",
    gatewayModel: "openai/gpt-image-2",
    provider: "openai",
    // OpenAI Images API only — there is no chat/multimodal route to this model,
    // so it is the sole `generateImage` entry and the sole reason that path
    // exists.
    path: "generateImage",
    priceNoteUsd: { low: 0.006, medium: 0.053, high: 0.211 },
    // These three happen to be both our pricing keys AND OpenAI's wire enum.
    // Stated explicitly rather than inferred from the price keys, so a future
    // pricing label (a "standard" row, a promo tier) cannot leak onto the wire.
    apiQualityValues: ["low", "medium", "high"],
    // Medium by decision, not by vendor default: low is visibly worse for the
    // panel drills and high runs past two minutes at 4× the price. The tier is
    // a run setting, so a deliberate high-quality comparison stays possible.
    qualityDefault: "medium",
    // The slow one: 15s typical, past two minutes at high quality. 240s sits
    // 60s under the route budget — double the stated headroom, because this is
    // the entry whose worst case is least bounded.
    timeoutMs: 240_000,
    // Non-zero on purpose even though carriage is unverified (below): a 0 here
    // would silently disable the reference picker for this model and quietly
    // remove it from the consistency drill.
    refImageLimit: 4,
    dataUseNote:
      "OpenAI API default: no training on API inputs/outputs. Re-verify the " +
      "enterprise-privacy page before the first real-child-content run (it " +
      "403'd during research 2026-08-05).",
    restrictions: [
      "Slowest launch model: 15s typical, 2+ min at high quality.",
      "High quality is ~35× the price of low ($0.211 vs $0.006 per 1024² image).",
    ],
    verified: {
      gatewayRoutable: routableByCatalog("GatewayImageModelId"),
      referenceImageInput: {
        status: "unverified",
        note:
          "The SDK's GenerateImagePrompt accepts { images, text, mask }, so the " +
          "CALL shape exists; whether the gateway carries image inputs through " +
          "to OpenAI is unconfirmed. If it cannot, this is a SCOPE decision " +
          "(gpt-image-2 documented as text-to-image-only in the head-to-head, " +
          "or the GPT-5.x image_generation tool path) — escalate, do not paper " +
          "over it with a silent fallback.",
      },
      costReporting: COST_REPORTING_UNCONFIRMED,
      personGeneration: {
        status: "confirmed",
        note:
          "No allowlist gates person output on the OpenAI Images API; ordinary " +
          "content moderation still applies and normalizes to safety_blocked.",
      },
    },
  },
  {
    id: "gemini-3-pro-image",
    gatewayModel: "google/gemini-3-pro-image",
    provider: "google",
    // Nano Banana Pro. Multimodal: images arrive in result.files.
    path: "multimodal",
    // Single-tier pricing. No apiQualityValues: Gemini takes no quality
    // parameter, so "standard" is a price label and nothing more.
    priceNoteUsd: { standard: 0.134 },
    qualityDefault: "standard",
    // ~seconds in practice; 60s is a generous ceiling that still leaves 240s of
    // the route budget unused for the storage put.
    timeoutMs: 60_000,
    // ~5 character + 6 object reference images.
    refImageLimit: 11,
    dataUseNote:
      "Gemini API paid tier: prompts and responses are not used for training.",
    restrictions: [
      "personGeneration allowlist required for people/characters; without it, " +
        "hero prompts return PROHIBITED_CONTENT.",
      "Thinking model: emits interim draft images before the final one.",
    ],
    providerOptions: {
      // Without an explicit IMAGE modality the model can answer a picture
      // request with prose, producing a billed call and zero files — which
      // normalizes to provider_error and looks like a gateway fault.
      google: { responseModalities: ["TEXT", "IMAGE"] },
    },
    verified: {
      gatewayRoutable: routableByCatalog("GatewayModelId"),
      referenceImageInput: {
        status: "confirmed",
        note:
          "Multimodal path carries reference images as ordinary file parts in " +
          "the user message — the same mechanism as any image input.",
      },
      costReporting: COST_REPORTING_UNCONFIRMED,
      personGeneration: GEMINI_PERSON_GENERATION,
    },
  },
  {
    id: "gemini-3.1-flash-lite-image",
    gatewayModel: "google/gemini-3.1-flash-lite-image",
    provider: "google",
    // Nano Banana 2 Lite.
    path: "multimodal",
    priceNoteUsd: { standard: 0.0336 },
    qualityDefault: "standard",
    // ~4s documented. The cheap, fast cell.
    timeoutMs: 60_000,
    refImageLimit: 14,
    dataUseNote:
      "Gemini API paid tier: prompts and responses are not used for training.",
    restrictions: [
      "personGeneration allowlist required for people/characters; without it, " +
        "hero prompts return PROHIBITED_CONTENT.",
    ],
    providerOptions: {
      google: { responseModalities: ["TEXT", "IMAGE"] },
    },
    verified: {
      gatewayRoutable: routableByCatalog("GatewayModelId"),
      referenceImageInput: {
        status: "confirmed",
        note:
          "Multimodal path carries reference images as ordinary file parts; up " +
          "to 14 input images documented.",
      },
      costReporting: COST_REPORTING_UNCONFIRMED,
      personGeneration: GEMINI_PERSON_GENERATION,
    },
  },
] as const satisfies readonly ImageLabModelEntry[]);

/** Every entry, in launch order (the order the compare selector renders). */
export const IMAGE_LAB_MODELS: readonly ImageLabModelEntry[] = ENTRIES;

/**
 * Look up an entry, or null.
 *
 * FAILS CLOSED and returns a nullable rather than throwing: the caller is a
 * route resolving a `model_id` read back from Postgres, and a model retired from
 * the registry while its history rows survive is an ordinary, expected state.
 * The adapter turns the null into `unconfigured` — a recorded, filterable
 * outcome — instead of a 500 that loses which cell it was.
 */
export function findModelEntry(
  id: string | null | undefined
): ImageLabModelEntry | null {
  return ENTRIES.find((entry) => entry.id === id) ?? null;
}

/**
 * List price for one image at a quality tier, or null if the tier is unknown.
 *
 * Null rather than a silent fall back to the default tier: a request naming a
 * tier this model does not have is a bug in the caller, and quietly costing it
 * at `medium` would put a wrong number in the evidence the Lab exists to
 * produce. The adapter REFUSES such a request outright rather than dialling it.
 */
export function estimatedCostUsd(
  entry: ImageLabModelEntry,
  quality?: string | null
): number | null {
  const key = quality ?? entry.qualityDefault;
  return Object.prototype.hasOwnProperty.call(entry.priceNoteUsd, key)
    ? entry.priceNoteUsd[key]!
    : null;
}

/** Quality tiers this model offers, for the run-settings selector. */
export function qualityTiers(entry: ImageLabModelEntry): string[] {
  return Object.keys(entry.priceNoteUsd);
}

/**
 * Does this entry have any capability question still open?
 *
 * Drives an honest badge on the bench rather than leaving the caveat in a
 * planning doc: staff choosing between models deserve to see that one of them
 * may refuse every hero prompt until paperwork clears.
 */
export function unverifiedItems(entry: ImageLabModelEntry): string[] {
  return Object.entries(entry.verified)
    .filter(([, note]) => note.status === "unverified")
    .map(([key]) => key);
}

/**
 * Refuse to load a route whose `maxDuration` cannot contain the slowest model.
 *
 * CALL THIS AT MODULE SCOPE in any route that generates, so the mismatch is a
 * deploy-time crash rather than a production mystery.
 *
 * The failure it prevents is silent and expensive, and the repo already leans
 * toward it: the nearest precedent (app/fp/fw/.../import/page.tsx) sets
 * `maxDuration = 60`. Copy that here and gpt-image-2's 240s abort can NEVER
 * fire — the platform kills the invocation first, so no finalize runs, the row
 * is stuck `requested` with `attempted_at` set (which blocks retry for the full
 * staleness window), and the vendor bills for the image anyway.
 */
export function assertRouteBudget(maxDurationSeconds: number): void {
  const slowestMs = Math.max(...ENTRIES.map((entry) => entry.timeoutMs));
  const requiredMs = slowestMs + IMAGE_LAB_TIMEOUT_HEADROOM_MS;
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error(
      `[image-lab] assertRouteBudget needs a positive maxDuration in seconds, got ${maxDurationSeconds}`
    );
  }
  if (requiredMs > maxDurationSeconds * 1000) {
    throw new Error(
      `[image-lab] route maxDuration ${maxDurationSeconds}s is too short: the ` +
        `slowest model needs ${slowestMs}ms plus ${IMAGE_LAB_TIMEOUT_HEADROOM_MS}ms ` +
        `of finalize headroom (${requiredMs}ms). Raise maxDuration to at least ` +
        `${Math.ceil(requiredMs / 1000)}s, or lower the model timeouts.`
    );
  }
}
