/**
 * Image Lab — the run flow's PURE rules and its copy
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R3, R5, R7, R12, R16).
 *
 * PLAIN module — no next/supabase/react/ai imports — because this repo runs
 * `environment: "node"` with NO jsdom. A decision written inline in a `.tsx` is a
 * decision CI cannot see, and Unit 4's review proved the alternative empirically:
 * NINE source-scan tests over `ReferenceLibrary` survived deleting the
 * component's warning outright. So every decision the composer, the grid and the
 * route take is made HERE and asserted in `__tests__/run-rules.test.ts`; the
 * component's only job is to render what these functions return.
 *
 * ── WHAT THIS MODULE OWNS ──────────────────────────────────────────────────
 *   * slot RESOLUTION (template × slot values → the exact text sent) and the
 *     warn-not-block unfilled-slot notice;
 *   * CELL EXPANSION (models × image count) and the compare-subset rule;
 *   * the STALENESS RENDER RULE and what a cell looks like in the grid;
 *   * the COST ESTIMATE, before anything is spent;
 *   * the generate-cell COOLDOWN config and the client's own await budget;
 *   * all user-facing copy, in ONE exported constant.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ──────────────────────────────────────
 * The slot vocabulary, the staleness constant, the mime allowlist and the
 * failure/verdict sets are Unit 1's (`./image-lab-rules`) and are IMPORTED. A
 * second copy of "what is a slot" is a second answer to the one question the
 * panel engine inherits.
 */

import {
  classifySlots,
  isImageStale,
  IMAGE_LAB_SLOTS,
  IMAGE_LAB_STALE_AFTER_MS,
  type ImageLabFailureReason,
  type ImageLabImageState,
  type ImageLabSlot,
} from "./image-lab-rules";
import {
  estimatedCostUsd,
  findModelEntry,
  unverifiedItems,
  IMAGE_LAB_ROUTE_BUDGET_MS,
  type ImageLabModelEntry,
} from "./model-registry";
import {
  deriveCategoryPrompt,
  isCategoryDerivedPrompt,
} from "./category-prompt-rules";
import type { RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";

// ── Bounds ───────────────────────────────────────────────────────────────────

/**
 * Candidates per model, per run. Four is the origin's number and it is also what
 * keeps the worst case affordable: 3 models × 4 candidates = 12 cells, which is
 * **$0.8824** — 4×$0.053 + 4×$0.134 + 4×$0.0336.
 *
 * ⚠ NOT $2.53, AND THE STALE FIGURE CAME WITH A STALE PREMISE. The earlier number
 * was 12 × gpt-image-2 at HIGH, "and quality is a run setting". Quality is NOT a
 * run setting in v1 — `fp_image_lab_runs` has no `quality` column (see
 * `run-core.ts`'s header and `model-registry.ts`), so every cell dials its
 * model's `qualityDefault`, and a 12-cell fan is 4+4+4 across three DIFFERENT
 * models rather than twelve of the dearest one. The premise outlived its unit and
 * carried the arithmetic with it into two other files.
 *
 * The figure is DERIVED rather than restated: {@link maxFanCostUsd} computes it
 * from `decideRunComposition` over the registry, and `run-rules.test.ts` pins it.
 */
export const IMAGE_LAB_MAX_IMAGE_COUNT = 4;

/**
 * The largest fan one compose can produce. DERIVED, never typed twice: it is
 * what sizes the cooldown burst allowance below, and a hardcoded 12 that drifted
 * from the registry would refuse a legitimate run on the day a fourth model
 * lands.
 */
export const IMAGE_LAB_MAX_CELLS_PER_RUN = 3 * IMAGE_LAB_MAX_IMAGE_COUNT;

/** Mirrors `fp_image_lab_runs_template_bounded` in the migration. */
export const IMAGE_LAB_TEMPLATE_MAX_CHARS = 8000;

/** Mirrors `fp_image_lab_runs_resolved_bounded` in the migration. */
export const IMAGE_LAB_RESOLVED_MAX_CHARS = 12000;

/** Mirrors `fp_image_lab_runs_note_bounded`. */
export const IMAGE_LAB_NOTE_MAX_CHARS = 2000;

/** Mirrors `fp_image_lab_runs_references_bounded`. */
export const IMAGE_LAB_MAX_REFERENCES_PER_RUN = 16;

// ── The cooldown, and the arithmetic behind it ───────────────────────────────

/**
 * The generate-cell server cooldown, keyed PER STAFF USER.
 *
 * ⚠ THE BURST ALLOWANCE IS DERIVED FROM THE MAX FAN, not chosen. The client
 * fires one request per cell, so a legitimate 12-cell compare arrives as twelve
 * requests within a second or two. A limit at or below 12 would refuse the
 * feature's own headline workflow — and it would refuse it PARTWAY, leaving a
 * run with some cells generated and some refused, which is the most confusing
 * possible failure. 30 per 5 minutes fits two full compare fans plus retries and
 * still caps a runaway priced loop well short of anything expensive.
 *
 * ⚠ CAVEAT, STATED RATHER THAN IMPLIED (`app/fp/lib/rate-limit-store.ts` says so
 * itself): the store is PER-INSTANCE and BEST-EFFORT. A cold start or a second
 * warm instance begins with an empty window, and bucket eviction fails OPEN.
 * This is a guardrail on one staff member's own tab, not a global spend bound.
 * The real bound is social — a staff-only bench behind `IMAGE_LAB_LIVE`.
 */
export const IMAGE_LAB_GENERATE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 5 * 60_000,
  limit: 2 * IMAGE_LAB_MAX_CELLS_PER_RUN + 6,
};

/** The bucket key for one staff member's generate-cell budget. */
export function generateCellRateLimitKey(staffId: string): string {
  return `image-lab:generate-cell:${staffId}`;
}

/**
 * The COMPOSE cooldown, keyed per staff user.
 *
 * ⚠ THROTTLING REDEMPTION ALONE LEFT THE SUPPLY UNBOUNDED. `generate-cell` had a
 * bound and `createImageLabRun`/`retryImageLabCell` had none, so a loop could
 * mint unlimited generatable `requested` rows for free and then spend them at
 * whatever rate the other bucket allowed — across instances, and forever. A run
 * is cheap to write and expensive to redeem; both ends need a wall.
 *
 * ⚠ THIS NUMBER IS ITS OWN, AND IS DELIBERATELY *NOT* DERIVED — which is worth
 * saying out loud, because it sits twelve lines below a limit whose docblock
 * insists on being "DERIVED, never typed twice", and the two happen to be 30
 * today. That coincidence reads as a link, and a later edit to
 * `IMAGE_LAB_MAX_CELLS_PER_RUN` would silently change one and not the other while
 * they still looked paired.
 *
 * They answer different questions. The GENERATE limit is derived because it must
 * admit the feature's own headline workflow: the client fires one request per
 * cell, so the number has to be a function of the maximum fan or a legitimate
 * compare is refused partway. A COMPOSE is one request no matter how wide it
 * fans, so the fan is irrelevant here; what this bounds is HOW OFTEN a human
 * presses a button. Sized for real bench work: a staff member composing a new run
 * every ten seconds for five minutes is already far past deliberate use, and that
 * ceiling does not move when a fourth model lands.
 */
export const IMAGE_LAB_COMPOSE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 5 * 60_000,
  limit: 30,
};

export function composeRateLimitKey(staffId: string): string {
  return `image-lab:compose:${staffId}`;
}

/**
 * The shape an id may have to be recorded as run provenance.
 *
 * ⚠ `source_idea_id` AND `source_task_id` ARE DOCUMENTED "internal ids ONLY —
 * never a name", and they arrived as free 200-character client strings on a
 * column the migration header lists as consent-audit evidence. A closed
 * character class is the difference between a documented intention and an
 * enforced one.
 */
export const IMAGE_LAB_SOURCE_ID_PATTERN = /^[A-Za-z0-9:._-]{1,64}$/;

export function isRecordableSourceId(value: string | null | undefined): boolean {
  return value === null || value === undefined || IMAGE_LAB_SOURCE_ID_PATTERN.test(value);
}

/**
 * How long the BROWSER waits for one generate-cell response.
 *
 * ⚠ STRICTLY GREATER THAN THE SERVER BUDGET, and this is the one inequality in
 * the feature that costs money when it is inverted. If the client gives up first,
 * the server keeps going, the vendor still bills, and the staff member — looking
 * at a cell that says "failed" — retries. Duplicate spend becomes the DESIGNED
 * behaviour for the slowest model, which is exactly the model whose economics the
 * Lab exists to measure. The margin covers request/response transit on top of the
 * function's own ceiling.
 */
export const IMAGE_LAB_CLIENT_AWAIT_MS = IMAGE_LAB_ROUTE_BUDGET_MS + 30_000;

/**
 * How many generate-cell requests the browser keeps in flight at once.
 *
 * ⚠ THREE FINDINGS, ONE CONSTANT, AND THE FIRST ONE COSTS MONEY:
 *
 *  1. TWELVE `AbortSignal.timeout` CLOCKS ALL START AT t=0. The client fired the
 *     whole fan with `Promise.all`, so every signal began counting while the
 *     requests were still QUEUED — HTTP/1.1 caps six per host, so cells 7–12
 *     could burn a minute of their own budget before being sent. That inverts
 *     {@link IMAGE_LAB_CLIENT_AWAIT_MS} > route budget, which is the one
 *     inequality in this feature whose failure is duplicate spend. Bounding the
 *     fan means each signal is created AT DISPATCH.
 *  2. TWELVE CONCURRENT INVOCATIONS CO-LOCATE on one Fluid instance, each
 *     holding up to sixteen reference buffers plus result bytes. An OOM kills
 *     all twelve with no finalize on any of them — the blanked run origin R3
 *     exists to forbid.
 *  3. IT MAKES THE PER-INSTANCE COOLDOWN MEANINGFUL. A burst that all arrives
 *     inside one millisecond is a burst the bucket cannot shape.
 *
 * Four rather than three so a 4-candidate single-model run still fans in one
 * wave, and comfortably under the six-per-host floor.
 */
export const IMAGE_LAB_CLIENT_FAN_CONCURRENCY = 4;

/** How often the grid re-reads a run while any cell is non-final. */
export const IMAGE_LAB_CELL_POLL_MS = 5_000;

/**
 * The cap on ONE Supabase round trip inside the paid path.
 *
 * Nothing in the Supabase client sets a fetch timeout, and on the paid path a
 * call that never settles is not slowness — it is the vendor billed, no put, no
 * finalize, no audit, and the row latched for the full staleness window. Five
 * seconds is well past any healthy round trip and short enough that four of them
 * plus the reference load still fit under the pre-adapter budget below.
 */
export const IMAGE_LAB_DB_CALL_TIMEOUT_MS = 5_000;

/** The cap on loading a run's whole reference set — CONCURRENTLY, so this is a
 *  wall-clock bound on up to {@link IMAGE_LAB_MAX_REFERENCES_PER_RUN} downloads
 *  rather than a per-object one. */
export const IMAGE_LAB_REFERENCE_LOAD_TIMEOUT_MS = 15_000;

/**
 * Everything the route may spend BEFORE the adapter is dialled.
 *
 * ⚠ THE ADAPTER'S OWN TIMEOUT WAS THE ONLY THING `assertRouteBudget` KNEW ABOUT,
 * and the reference load was not in the arithmetic at all — sixteen SEQUENTIAL
 * object downloads after the CAS, on a 300s function whose slowest model already
 * claims 240s. A reference-heavy run could be killed by the platform with the
 * vendor billed and nothing recorded. The route now declares this number to
 * `assertRouteBudget`, so the sum failing to fit is a BUILD error.
 *
 * The terms: the reference load, plus the three DB round trips ahead of it
 * (`loadCell`, `loadRun`, the CAS).
 */
export const IMAGE_LAB_PRE_ADAPTER_BUDGET_MS =
  IMAGE_LAB_REFERENCE_LOAD_TIMEOUT_MS + 3 * IMAGE_LAB_DB_CALL_TIMEOUT_MS;

/**
 * Run an async job over each item with a bounded number in flight.
 *
 * PURE (it takes the worker), so the fan bound is asserted in the node suite
 * rather than living inline in a `.tsx` no test can render. Results come back in
 * INPUT ORDER regardless of completion order — the grid's column order is the
 * run's, and a fan that reordered its own answers would be a second, invisible
 * source of truth about it.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const bound = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(bound, items.length) }, () => lane())
  );
  return results;
}

// ── Slot resolution ──────────────────────────────────────────────────────────

/** Slot values as the composer holds them: every known slot, possibly empty. */
export type SlotValues = Partial<Record<ImageLabSlot, string>>;

export type ResolvedPrompt = {
  /** The exact text that will be sent. */
  readonly text: string;
  /** Known slots with no value. Warned about, NEVER blocked. */
  readonly unfilled: readonly ImageLabSlot[];
  /** `{{tokens}}` that are not slots at all (a typo, or a deliberate test). */
  readonly unknown: readonly string[];
};

/** A fresh matcher per call — the shared-`lastIndex` trap `image-lab-rules`
 *  documents at length. Same shape as `extractSlotNames`'s, deliberately. */
const slotMatcher = () => /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Template × slot values → the exact prompt, plus what was left unfilled.
 *
 * ⚠ AN UNFILLED SLOT KEEPS ITS LITERAL. It is NOT replaced with an empty string
 * and it is NOT a refusal: a deliberate template test ("does this model do
 * anything sensible with `{{product}}` left in?") is a legitimate run, and
 * silently blanking the token would make the resolved-prompt preview lie about
 * what the vendor saw. The composer warns; the staff member decides.
 *
 * ⚠ VALUES ARE SUBSTITUTED LITERALLY — no re-scan of the substituted text. A
 * slot value that itself contains `{{pitch}}` (child-authored free text can
 * contain anything) must not expand recursively; one pass over the TEMPLATE is
 * the whole rule, and `replace` with a function callback is what guarantees a
 * `$&` inside a value is not treated as a replacement pattern either.
 */
export function resolvePrompt(
  template: string,
  values: SlotValues
): ResolvedPrompt {
  const classified = classifySlots(template);
  const unfilled: ImageLabSlot[] = [];

  const text = template.replace(slotMatcher(), (whole, rawName: string) => {
    if (!(IMAGE_LAB_SLOTS as readonly string[]).includes(rawName)) return whole;
    const name = rawName as ImageLabSlot;
    const value = values[name];
    if (typeof value !== "string" || value.trim() === "") {
      if (!unfilled.includes(name)) unfilled.push(name);
      return whole;
    }
    return value;
  });

  return { text, unfilled, unknown: classified.unknown };
}

// ── The prompt a CELL carries ────────────────────────────────────────────────

/**
 * WHICH TEXT A CELL SENDS — a per-model, staff-controlled choice.
 *
 *   * `authored` — the template resolved against the slot values, i.e. the
 *     child's own words where the picker filled them. What the bench has always
 *     sent.
 *   * `derived`  — the category-derived prompt from `./category-prompt-rules`:
 *     a member of a closed, non-identifying vocabulary, carrying no substring of
 *     any slot value.
 *
 * ⚠ PER MODEL, NOT PER RUN, AND THAT IS THE FEATURE. The Lab exists to find the
 * best prompt for each model, not to run a fair tournament between models — see
 * `category-prompt-rules`'s header for the owner's own words on this. Sending
 * `gpt-image-2` one phrasing and `gemini-3-pro-image` another in the SAME run is
 * a legitimate, and frequently the most informative, experiment.
 */
export const IMAGE_LAB_PROMPT_MODES = ["authored", "derived"] as const;
export type ImageLabPromptMode = (typeof IMAGE_LAB_PROMPT_MODES)[number];
export function isImageLabPromptMode(value: unknown): value is ImageLabPromptMode {
  return (IMAGE_LAB_PROMPT_MODES as readonly unknown[]).includes(value);
}

/** Per-model overrides. A model absent from the map takes {@link defaultPromptMode}. */
export type PromptModes = Readonly<Record<string, ImageLabPromptMode>>;

/**
 * THE STAFF ATTESTATION — the thing that makes the safe path the DEFAULT.
 *
 * ⚠ PROVENANCE IS A PROPERTY OF THE FETCH PATH, NOT OF THE CONTENT. `childProvenance`
 * is true only when the picker's signed token verified. It says "this text came out
 * of a child's saved work through OUR endpoint" — it does not, and cannot, say "this
 * text is not a child's". So a staff member who reads a child's pitch off a support
 * ticket and types it into the TEMPLATE produces a compose with no token, no slot
 * values, `sourceChildId` null — and every provenance-keyed defence in this feature
 * (the re-scrub, the derived default, the dispatch gate) sees nothing to act on. That
 * is the same class of hole `./source-token.ts` closed once already: a guard keyed on
 * an optional client-supplied field, defeated by DELETING the field rather than by
 * forging it.
 *
 * The fix is not to force `derived` everywhere. Unimpeded per-model prompt
 * experimentation on OpenAI is what the bench is FOR, and a bench that can only send
 * one of 200 fixed strings to gpt-image-2 is not a prompt bench. The fix is an
 * explicit, server-recorded assertion by a named staff member:
 *
 *   * ABSENT / FALSE ⇒ OpenAI cells derive, exactly as if provenance were present.
 *     Nothing is refused; the run composes and generates, on the vocabulary.
 *   * TRUE ⇒ authored text is allowed to OpenAI, and the boolean is persisted on
 *     the run row beside `staff_id`, so the choice has an owner and a timestamp.
 *
 * The safe path is therefore the DEFAULT and the LAZY path is safe. Staff running
 * synthetic prompt experiments tick one box and lose nothing. Staff who paste a
 * child's sentence and never think about it are protected by having done nothing.
 *
 * ⚠ IT BINDS OPENAI ONLY, like everything else here. A Google cell is never
 * constrained by the attestation, present or absent.
 */
export type PromptGateContext = {
  /** Did a picker-minted provenance token VERIFY for this run? */
  readonly childProvenance: boolean;
  /** Did the caller explicitly assert the template and slot values are free of
   *  child-authored content? Absent is false, and false is the safe answer. */
  readonly noChildContentAttested: boolean;
};

/**
 * The mode this model has NO CHOICE about, or `null` when the staff choice stands.
 *
 * ⚠ AN UNKNOWN MODEL IS NOT FORCED HERE, and that is not a hole: `decideRunComposition`
 * refuses an unknown model id outright, and {@link decideChildTextGate} fails CLOSED on
 * one at dispatch. This function answers a composer question ("is the select locked?"),
 * and a model that cannot be composed has no select.
 */
export function forcedPromptMode(
  modelId: string,
  ctx: PromptGateContext
): ImageLabPromptMode | null {
  if (findModelEntry(modelId)?.provider !== "openai") return null;
  return ctx.childProvenance || ctx.noChildContentAttested !== true ? "derived" : null;
}

/**
 * What a model sends when the staff member has not said.
 *
 * ⚠ THE DEFAULT IS A CONVENIENCE, NOT THE ENFORCEMENT. It picks `derived` for an
 * OpenAI model on a provenance-bearing or un-attested run so the composer does the
 * lawful thing without anyone having to remember — but the enforcement is
 * {@link decideChildTextGate}, server-side, at dispatch. A default is a thing a
 * client can disagree with; a gate is not.
 *
 * Google models default to `authored` DELIBERATELY. Over-restriction is a real
 * defect here: the Gemini paid tier carries no under-18 processing bar, and
 * quietly sanitizing those cells would remove the experiment the bench is for.
 */
export function defaultPromptMode(
  modelId: string,
  childProvenance: boolean,
  noChildContentAttested = false
): ImageLabPromptMode {
  return forcedPromptMode(modelId, { childProvenance, noChildContentAttested }) ?? "authored";
}

/**
 * The mode this model will ACTUALLY be composed with.
 *
 * ⚠ THE FORCED MODE WINS OVER AN EXPLICIT ENTRY, and that ordering is a bug fix.
 * This used to return `modes[modelId]` whenever it was a valid mode, falling back to
 * the default only when absent — while the composer's `promptModes` state is written
 * only by the select's `onChange` and is never cleared when a token arrives or a chip
 * is deselected. So: set gpt-image-2 to "As written", THEN fill the slots from a
 * child, and the stale explicit entry survived. The select rendered `disabled` while
 * still SHOWING "As written"; the preview — the surface this feature's own docs call
 * the last human check on child-authored text leaving for a vendor — showed the
 * child's pitch as what would be sent; every cell was composed with it and priced in
 * the estimate; all of them 403'd at dispatch; and the refusal copy told staff to
 * switch the model to derived using a control the UI had just disabled. The only
 * escape was a reload that discarded the composition.
 *
 * Fixing it HERE rather than in the composer is deliberate: this is the one layer
 * both the preview and `decideRunComposition` read, and it is the only one this
 * suite (node, no jsdom) can test.
 */
export function promptModeFor(
  modelId: string,
  childProvenance: boolean,
  modes: PromptModes | undefined,
  noChildContentAttested = false
): ImageLabPromptMode {
  const forced = forcedPromptMode(modelId, { childProvenance, noChildContentAttested });
  if (forced !== null) return forced;
  const chosen = modes?.[modelId];
  return isImageLabPromptMode(chosen)
    ? chosen
    : defaultPromptMode(modelId, childProvenance, noChildContentAttested);
}

/** The exact text one model's cells will carry, and whether it is derived. */
export type CellPrompt = {
  readonly text: string;
  readonly derived: boolean;
};

export function promptForModel(input: {
  modelId: string;
  authoredText: string;
  slotValues: SlotValues;
  childProvenance: boolean;
  noChildContentAttested?: boolean;
  promptModes?: PromptModes;
}): CellPrompt {
  const mode = promptModeFor(
    input.modelId,
    input.childProvenance,
    input.promptModes,
    input.noChildContentAttested === true
  );
  if (mode === "authored") return { text: input.authoredText, derived: false };
  return { text: deriveCategoryPrompt(input.slotValues).text, derived: true };
}

// ── THE ONE NON-OVERRIDABLE RULE ─────────────────────────────────────────────

export type ChildTextGateVerdict =
  | { ok: true }
  /** An OpenAI cell on a constrained run (provenance-bearing, or not attested as
   *  child-content-free) is carrying text that is not from the closed derived
   *  vocabulary. */
  | { ok: false; reason: "child_text_to_openai" }
  /** An OpenAI cell on a provenance-bearing run is carrying REFERENCE IMAGES.
   *  Named separately from the text refusal on purpose — the two have different
   *  causes and different fixes, and History must be able to tell them apart. */
  | { ok: false; reason: "child_reference_to_openai" }
  /** The model id is not in the registry, so no vendor posture can be proven for
   *  it. Refused rather than waved through — see the fail-CLOSED note below. */
  | { ok: false; reason: "unknown_model" };

/**
 * MAY THIS EXACT STRING BE DISPATCHED TO THIS MODEL?
 *
 * ⚠ IT TAKES THE RESOLVED, ABOUT-TO-BE-DISPATCHED TEXT. Not the template, not the
 * slot values, not the run's default prompt — the string the adapter is one line
 * away from sending. A gate on the pre-resolution template proves nothing: a
 * template of pure `{{slot}}` tokens is innocent-looking and resolves to the
 * child's entire pitch, and a template a staff member typed the derived wording
 * into by hand would wave through a cell whose stored prompt is something else
 * entirely.
 *
 * ⚠ AND IT RETURNS A REFUSAL, NEVER A SUBSTITUTION. Silently swapping in the
 * derived prompt would make the persisted row misreport its own input: the bench
 * would show "we sent X", the vendor would have received Y, and every judgement
 * made on that image would be attributed to a prompt that never ran. The whole
 * point of this unit is that the row tells the truth about what produced it.
 *
 * ⚠ GOOGLE MODELS ARE NOT GATED. That is not an oversight and must not be
 * "tightened": the Gemini paid tier is confirmed no-training with no under-18
 * processing bar, `IMAGE_LAB_REAL_CONTENT_LIVE` is the switch that governs child
 * content reaching it, and gating it here would block the experimentation the Lab
 * exists for. `run-rules.test.ts` has a named test that a Google cell with
 * authored child text passes, and one that a Google cell keeps its references.
 *
 * ⚠ IT FAILS CLOSED ON AN UNKNOWN MODEL ID. This used to read
 * `const provider = entry?.provider ?? null; if (provider !== "openai") return { ok: true }`
 * — so an id the registry has never heard of took the GOOGLE exit and PASSED. Nothing
 * escaped only because `image-model.ts` does its own exact-match lookup and answers
 * `unconfigured`, which means this gate's safety was entirely borrowed from a
 * different module's unrelated behaviour. An unknown model cannot generate anyway, so
 * refusing costs nothing and stops the borrowing.
 *
 * ⚠ AND IT GATES REFERENCE IMAGES, NOT ONLY TEXT. The gate's input used to be
 * `{ modelId, childProvenance, promptText }` — purely a text gate — while
 * `generateCell` loaded up to 16 reference objects and handed them to gpt-image-2 on
 * the very run whose TEXT had just been forced down to a 200-string vocabulary. The
 * only control was copy in an upload dialog. A photo of a child's hand-lettered stand
 * sign, uploaded as a "style reference", carries their handwriting, their business
 * name and possibly their likeness to OpenAI — while the derived prompt in the SAME
 * request instructs "No lettering, no logos, no brand names" precisely because those
 * are the privacy problem. References are append-only and undeletable, so the mistake
 * is permanent. Refused on the OpenAI leg of a provenance-bearing run; NEVER on a
 * Google cell.
 */
export function decideChildTextGate(input: {
  modelId: string;
  childProvenance: boolean;
  /** See {@link PromptGateContext}. Absent is false, and false is the safe answer. */
  noChildContentAttested?: boolean;
  promptText: string;
  /** Is this dispatch carrying reference-image bytes? */
  hasReferences?: boolean;
}): ChildTextGateVerdict {
  const entry = findModelEntry(input.modelId);
  // FAIL CLOSED. Not "unknown ⇒ probably fine": unknown ⇒ we cannot name the
  // vendor, cannot name its terms, and cannot generate on it either.
  if (!entry) return { ok: false, reason: "unknown_model" };
  if (entry.provider !== "openai") return { ok: true };

  // References answer to VERIFIED PROVENANCE only. The attestation below is an
  // assertion about the template and the slot values — the two things a staff
  // member types — and says nothing about what is inside an uploaded PNG.
  if (input.childProvenance && input.hasReferences === true) {
    return { ok: false, reason: "child_reference_to_openai" };
  }

  const constrained = input.childProvenance || input.noChildContentAttested !== true;
  if (!constrained) return { ok: true };
  return isCategoryDerivedPrompt(input.promptText)
    ? { ok: true }
    : { ok: false, reason: "child_text_to_openai" };
}

// ── Cell expansion ───────────────────────────────────────────────────────────

/**
 * One requested cell. `cellOrdinal` is the candidate's index WITHIN ITS MODEL'S
 * COLUMN, so `(model_id, cell_ordinal)` addresses a grid position and a retry can
 * carry the same pair as the attempt it replaces.
 *
 * It exists because `created_at` cannot do this job: Postgres `now()` is the
 * TRANSACTION timestamp, so every cell minted in the run's single insert shares
 * it byte-for-byte and ordering by it leaves the compare grid's order to the
 * executor (migration header, `fp_image_lab_images`).
 */
export type CellSpec = {
  readonly modelId: string;
  readonly cellOrdinal: number;
  /**
   * ⚠ THE EXACT TEXT THIS CELL WILL SEND, decided at compose and PERSISTED ON THE
   * IMAGE ROW (`fp_image_lab_images.resolved_prompt`).
   *
   * It is per cell rather than per run because the prompt is per model, and it is
   * STORED rather than recomputed because the whole value of this bench is
   * "this phrasing beat that one on this model" — a prompt reconstructed at read
   * time from a template someone has since edited is not evidence.
   */
  readonly promptText: string;
  /** Was {@link promptText} category-derived rather than child-authored? */
  readonly promptDerived: boolean;
};

export type RunCompositionRefusal =
  | { ok: false; reason: "no_models" }
  | { ok: false; reason: "unknown_model"; modelId: string }
  | { ok: false; reason: "bad_image_count"; max: number }
  | { ok: false; reason: "empty_template" }
  | { ok: false; reason: "template_too_long"; max: number }
  | { ok: false; reason: "prompt_too_long"; max: number }
  | { ok: false; reason: "too_many_references"; max: number }
  /** `source.childId` names a child this bench may not read (unknown, or a test
   *  family). Refused SERVER-SIDE — the field is client-asserted, and it is what
   *  the consent audit is filed under. */
  | { ok: false; reason: "unknown_source_child" }
  /** The idempotency key is already held by a run built from a DIFFERENT
   *  composition. Answering with the existing run would bill for template A
   *  while the composer shows template B. */
  | { ok: false; reason: "idempotency_conflict" }
  | { ok: false; reason: "bad_source_id" }
  /** The provenance token did not verify, or has expired. NEVER downgraded to
   *  the unprovenanced path — see `run-core`'s chokepoint. */
  | { ok: false; reason: "bad_source_token" }
  /** A compose carrying slot content with NO provenance token, while the content
   *  picker is live. */
  | { ok: false; reason: "unverified_slot_source" }
  /** Provenance was presented while `IMAGE_LAB_REAL_CONTENT_LIVE` is off. */
  | { ok: false; reason: "content_picker_off" };

export type RunComposition = {
  ok: true;
  readonly cells: readonly CellSpec[];
  /**
   * ⚠ TRUE ONLY FOR A GENUINE MULTI-MODEL FAN. A "compare" the staff member
   * built and then narrowed to ONE model is a normal run and is recorded as one
   * (plan: "Compare with one selected model is recorded as a normal run") — the
   * flag drives per-model comparison stats, and a single-model run marked
   * compare would put a one-column comparison in the evidence.
   */
  readonly compare: boolean;
  /**
   * The AUTHORED resolution — template × slot values.
   *
   * ⚠ THIS IS THE RUN-LEVEL DEFAULT AND THE COMPOSER'S WARN SOURCE, NOT
   * NECESSARILY WHAT ANY CELL SENT. Read {@link promptByModel} (or the image
   * row's own `resolved_prompt`) for that. It is stored on the run as
   * `resolved_prompt` and, like `template` and `slot_values`, goes nowhere.
   */
  readonly resolved: ResolvedPrompt;
  readonly modelIds: readonly string[];
  /** What each selected model will actually be sent. Drives the preview. */
  readonly promptByModel: Readonly<Record<string, CellPrompt>>;
};

export type RunCompositionDecision = RunComposition | RunCompositionRefusal;

/**
 * Everything decided about a compose BEFORE a row is written, in one pure call.
 *
 * ZERO MODELS REFUSES. It is the one input that cannot be interpreted: a run with
 * no cells is a row that can never be generated, can never fail, and would sit in
 * History forever as a run that looks pending.
 */
export function decideRunComposition(input: {
  template: string;
  slotValues: SlotValues;
  modelIds: readonly string[];
  imageCount: number;
  referenceIds?: readonly string[];
  /**
   * Does this compose carry VERIFIED child provenance?
   *
   * The composer passes "the picker minted a token"; `run-core` passes the
   * result of actually verifying it. They agree on every path that is not already
   * a refusal, which is what makes the preview honest.
   */
  childProvenance?: boolean;
  /**
   * The staff assertion that the template and slot values carry no child-authored
   * content — see {@link PromptGateContext}. ABSENT IS FALSE, which forces every
   * OpenAI cell onto the derived vocabulary exactly as provenance does.
   */
  noChildContentAttested?: boolean;
  promptModes?: PromptModes;
}): RunCompositionDecision {
  const template = input.template ?? "";
  if (template.trim() === "") return { ok: false, reason: "empty_template" };
  if (template.length > IMAGE_LAB_TEMPLATE_MAX_CHARS) {
    return { ok: false, reason: "template_too_long", max: IMAGE_LAB_TEMPLATE_MAX_CHARS };
  }

  // De-duplicated, order preserved: the compare grid's column order is the order
  // the chips were selected in, and a doubled model id would silently double the
  // bill for that column.
  const modelIds = [...new Set(input.modelIds)];
  if (modelIds.length === 0) return { ok: false, reason: "no_models" };
  for (const modelId of modelIds) {
    if (!findModelEntry(modelId)) return { ok: false, reason: "unknown_model", modelId };
  }

  const count = input.imageCount;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > IMAGE_LAB_MAX_IMAGE_COUNT
  ) {
    return { ok: false, reason: "bad_image_count", max: IMAGE_LAB_MAX_IMAGE_COUNT };
  }

  if ((input.referenceIds?.length ?? 0) > IMAGE_LAB_MAX_REFERENCES_PER_RUN) {
    return {
      ok: false,
      reason: "too_many_references",
      max: IMAGE_LAB_MAX_REFERENCES_PER_RUN,
    };
  }

  const resolved = resolvePrompt(template, input.slotValues ?? {});
  if (resolved.text.length > IMAGE_LAB_RESOLVED_MAX_CHARS) {
    return { ok: false, reason: "prompt_too_long", max: IMAGE_LAB_RESOLVED_MAX_CHARS };
  }

  const childProvenance = input.childProvenance === true;
  const noChildContentAttested = input.noChildContentAttested === true;
  const slotValues = input.slotValues ?? {};
  const promptByModel: Record<string, CellPrompt> = {};
  for (const modelId of modelIds) {
    promptByModel[modelId] = promptForModel({
      modelId,
      authoredText: resolved.text,
      slotValues,
      childProvenance,
      noChildContentAttested,
      promptModes: input.promptModes,
    });
  }

  const cells: CellSpec[] = [];
  for (const modelId of modelIds) {
    const prompt = promptByModel[modelId]!;
    for (let i = 0; i < count; i++) {
      cells.push({
        modelId,
        cellOrdinal: i,
        promptText: prompt.text,
        promptDerived: prompt.derived,
      });
    }
  }

  return {
    ok: true,
    cells,
    compare: modelIds.length > 1,
    resolved,
    modelIds,
    promptByModel,
  };
}

// ── Cost ─────────────────────────────────────────────────────────────────────

export type RunCostEstimate = {
  /** USD, summed over every cell. */
  readonly totalUsd: number;
};

/**
 * What this compose will cost, before it is submitted.
 *
 * ⚠ NO QUALITY PARAMETER, BECAUSE QUALITY IS NOT A RUN SETTING IN v1.
 * `fp_image_lab_runs` has no `quality` column (see `run-core.ts`'s header), so
 * every cell dials the registry's `qualityDefault` and there was never a
 * production caller that passed anything else. The parameter, its `unpriced`
 * report and the composer warning that rendered it were three pieces of dead
 * machinery describing a control the bench does not offer — and two tests pinned
 * a "worst case" of 12 × $0.211 that {@link decideRunComposition} cannot
 * produce, since 12 cells means 4+4+4 across three DIFFERENT models. The real
 * ceiling is {@link maxFanCostUsd}.
 */
export function estimateRunCostUsd(cells: readonly CellSpec[]): RunCostEstimate {
  let totalUsd = 0;
  for (const cell of cells) {
    const entry = findModelEntry(cell.modelId);
    const price = entry ? estimatedCostUsd(entry, null) : null;
    if (price !== null) totalUsd += price;
  }
  // Money, to the cent the display shows — floating addition of 0.0336 twelve
  // times otherwise renders "$0.40320000000000005".
  return { totalUsd: Math.round(totalUsd * 1e6) / 1e6 };
}

/**
 * The most one compose can cost, COMPUTED FROM THE COMPOSER'S OWN RULES rather
 * than asserted as a number.
 *
 * The largest legal fan is every model at `IMAGE_LAB_MAX_IMAGE_COUNT`, priced at
 * each model's fixed default tier. Stating it as arithmetic over
 * {@link decideRunComposition} is what stops the figure drifting when a fourth
 * model lands — and what stopped this file claiming a ceiling no fan could
 * actually reach.
 */
export function maxFanCostUsd(modelIds: readonly string[]): number {
  const decision = decideRunComposition({
    template: "x",
    slotValues: {},
    modelIds,
    imageCount: IMAGE_LAB_MAX_IMAGE_COUNT,
  });
  return decision.ok ? estimateRunCostUsd(decision.cells).totalUsd : 0;
}

/**
 * "$2.53" / "$0.0336" — cents for anything a staff member reads as money, FOUR
 * decimals under a dime.
 *
 * The threshold is a dime rather than a cent because the cheap models' whole
 * selling point lives below it: `gemini-3.1-flash-lite-image` is $0.0336 and
 * `gpt-image-2` at low is $0.006. Rounding those to "$0.03" and "$0.01" erases
 * the 5× difference the comparison exists to show.
 */
export function formatUsd(amount: number): string {
  return amount !== 0 && Math.abs(amount) < 0.1
    ? `$${amount.toFixed(4)}`
    : `$${amount.toFixed(2)}`;
}

// ── The grid's render rule ───────────────────────────────────────────────────

/** The minimum of an image row the grid and the route reason about. */
export type CellRow = {
  readonly id: string;
  readonly runId: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  readonly state: ImageLabImageState;
  readonly attemptedAtMs: number | null;
  readonly createdAtMs: number;
  readonly failureReason: ImageLabFailureReason | null;
  readonly failureDetail: string | null;
  readonly storageKey: string | null;
  readonly billed: boolean;
  readonly costEstimatedUsd: number | null;
  readonly costReportedUsd: number | null;
  /**
   * ⚠ THE EXACT TEXT THIS ATTEMPT WAS SENT — NON-NULLABLE, because every insert
   * path in this feature writes it (`createRun` from the composition, `retryCell`
   * carried forward from the attempt it replaces) and the table is empty in
   * production, so the "row that predates per-cell prompts" population does not
   * exist and never will. `fp_image_lab_images_done_needs_prompt` enforces the
   * same thing in the database for any row that reaches `done`.
   *
   * It used to be `string | null` and `generateCell` covered the null with
   * `cell.resolvedPrompt ?? run.resolvedPrompt` — a fallback to the run's AUTHORED
   * resolution, i.e. silently dispatching the child's own words for a cell that
   * had been composed derived. The fallback is gone; the loader reports a null as
   * an empty string and `generateCell` refuses to dispatch one.
   *
   * It is READ BACK AND DISPATCHED rather than recomputed, and it is what
   * {@link decideChildTextGate} is applied to at dispatch — the string in hand,
   * not a template it was once derived from.
   */
  readonly resolvedPrompt: string;
  readonly promptDerived: boolean;
};

/**
 * What the grid shows for one attempt.
 *
 * FIVE RENDER STATES over THREE persisted ones, and the two extra are derived on
 * purpose:
 *   * `requested` — minted, nothing has touched it (no `attempted_at`);
 *   * `pending`   — a vendor call is in flight;
 *   * `stale`     — non-finalized and old enough that retry is SAFE TO OFFER.
 * "Stale" is never written (migration header): persisting it would mean two
 * writers could disagree about a row nobody is watching.
 */
export type CellRenderState =
  | "requested"
  | "pending"
  | "stale"
  | "done"
  | "failed";

/**
 * The subset of a cell the two render rules actually read.
 *
 * Structural rather than the whole {@link CellRow}, because the CLIENT never
 * receives a `storage_key` (it gets a signed URL instead — the `ReferenceView`
 * argument). A rule typed against the full row would force the component to
 * either fabricate the missing field or keep a second copy of the rule.
 */
export type CellLifecycle = {
  readonly state: ImageLabImageState;
  readonly attemptedAtMs: number | null;
  readonly createdAtMs: number;
  /** Optional, and only {@link canRetryCell} reads them — see the two extra
   *  rules there. A caller holding only the three lifecycle fields still gets a
   *  correct answer for every ordinary cell. */
  readonly failureDetail?: string | null;
  readonly failureReason?: ImageLabFailureReason | null;
  readonly billed?: boolean;
};

export function cellRenderState(
  row: CellLifecycle,
  serverNowMs: number,
  staleAfterMs: number = IMAGE_LAB_STALE_AFTER_MS
): CellRenderState {
  if (row.state === "done" || row.state === "failed") return row.state;
  if (isImageStale(row, serverNowMs, staleAfterMs)) return "stale";
  return row.attemptedAtMs === null ? "requested" : "pending";
}

/**
 * ONE SENTENCE naming where every attempt in the grid currently stands
 * (Unit 7, keyboard/AT pass).
 *
 * ⚠ THIS EXISTS BECAUSE THE GRID ITSELF USED TO BE THE LIVE REGION. Wrapping
 * `<ResultGrid>` in `aria-live="polite"` makes EVERY mutation inside it an
 * announcement: twelve cards' worth of headings, cost lines, failure prose and
 * button labels re-read on each three-second poll tick, plus again whenever a
 * Retry button's `disabled` flips. A screen-reader user could not hear the one
 * fact they were waiting for — that a cell finished — through the noise.
 *
 * So the live region is a SEPARATE, visually hidden sentence, and this is the
 * sentence. It is pure and asserted in `run-rules.test.ts` because the component
 * cannot be rendered by this (node, no-jsdom) suite.
 *
 * Counted over ATTEMPT ROWS, not cells, and it says "attempts" out loud: a
 * retried cell has two rows, and a census that silently collapsed them would
 * disagree with the cards the same reader is tabbing through. Empty in → empty
 * out, so an empty grid announces nothing at all rather than "0 attempts".
 *
 * Only non-zero buckets are named: "6 attempts: 4 done, 2 generating" is a
 * sentence someone can hold, where the seven-bucket version is a chore.
 */
export function describeCellProgress(
  cells: readonly CellLifecycle[],
  serverNowMs: number,
  staleAfterMs: number = IMAGE_LAB_STALE_AFTER_MS
): string {
  if (cells.length === 0) return "";
  const counts = new Map<CellRenderState, number>();
  for (const cell of cells) {
    const state = cellRenderState(cell, serverNowMs, staleAfterMs);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const copy = IMAGE_LAB_RUN_COPY.grid;
  // Fixed order, from the constant rather than from Map insertion order — the
  // announcement must not re-order itself between two polls and read as a change.
  const parts = CELL_PROGRESS_ORDER.filter((state) => (counts.get(state) ?? 0) > 0).map(
    (state) => `${counts.get(state)} ${copy.progressState[state]}`
  );
  return copy.progress(cells.length, parts);
}

/**
 * WHAT ONE ATTEMPT IS CALLED — the accessible name, and the one on screen
 * (Unit 7's AT pass; History's Unit 6 rule, lifted so the bench uses it too).
 *
 * ⚠ THE ATTEMPT INDEX IS PART OF THE NAME WHEN THERE IS MORE THAN ONE.
 * History learned this in Unit 6: two attempts at one cell rendered as
 * "gpt-image-2 candidate 3" twice — same heading, same `aria-label`, different
 * picture, independent Keep buttons. The BENCH grid still had the older half of
 * that bug at Unit 7: it stacks attempts inside a cell and gave every one of
 * them the identical `alt`, so a screen-reader user tabbing a retried cell heard
 * the same image described twice with nothing to tell them apart.
 *
 * `of === 1` deliberately yields the SHORT name. Appending "attempt 1 of 1" to
 * every card would make the overwhelmingly common case wordier to fix the rare
 * one.
 */
export function cellAttemptName(
  modelId: string,
  cellOrdinal: number,
  attempt: { readonly index: number; readonly of: number }
): string {
  const base = `${modelId} candidate ${cellOrdinal + 1}`;
  const numbering = describeAttemptNumbering(attempt);
  return numbering === "" ? base : `${base}, ${numbering}`;
}

/**
 * WHICH ATTEMPT THIS IS, as one phrase — the ONE numbering rule.
 *
 * ⚠ THE VISIBLE LINE USED TO BE A SECOND, HAND-BUILT COPY OF THIS. `ResultGrid`
 * rendered `attempt ${n} of ${m}${earlier}` inline, so the sentence a sighted
 * reader sees and the sentence in the accessible name were two independent
 * spellings of one fact, neither in the COPY constant (contrary to this file's
 * whole convention) and neither under test. Both are derived from here now, and
 * the strings live in `IMAGE_LAB_RUN_COPY.grid` with everything else.
 *
 * Empty for a single attempt, which is what makes `cellAttemptName` fall back to
 * the short name and the grid render no line at all.
 */
export function describeAttemptNumbering(attempt: {
  readonly index: number;
  readonly of: number;
}): string {
  return attempt.of > 1 ? IMAGE_LAB_RUN_COPY.grid.attemptOrdinal(attempt.index, attempt.of) : "";
}

/**
 * The numbering line the grid PRINTS, which adds one thing the accessible name
 * deliberately does not: whether this card is an EARLIER attempt than the one on
 * top. The stack is newest-first, so "earlier" is positional and belongs on the
 * visible line rather than in a name a reader hears out of context.
 */
export function describeAttemptLine(attempt: {
  readonly index: number;
  readonly of: number;
}): string {
  const numbering = describeAttemptNumbering(attempt);
  if (numbering === "") return "";
  return attempt.index === attempt.of
    ? numbering
    : `${numbering}${IMAGE_LAB_RUN_COPY.grid.attemptEarlier}`;
}

const CELL_PROGRESS_ORDER: readonly CellRenderState[] = [
  "done",
  "failed",
  "pending",
  "requested",
  "stale",
];

/**
 * May the grid offer Retry on this attempt?
 *
 * ⚠ DISABLED UNTIL STALENESS for anything not finalized. A cell that is `pending`
 * has a vendor call running; retrying it pays twice for one intent, and the CAS
 * cannot save us because a retry mints a NEW row with a fresh id that passes its
 * own CAS cleanly. Waiting out {@link IMAGE_LAB_STALE_AFTER_MS} is the only
 * honest signal we have that nothing is still coming.
 *
 * A FAILED row is retryable immediately — but the copy still warns that a late
 * success may land on top of it (`failed → done` is a real transition when a
 * killed function's vendor call completes afterwards).
 */
export function canRetryCell(
  row: CellLifecycle,
  serverNowMs: number,
  staleAfterMs: number = IMAGE_LAB_STALE_AFTER_MS
): boolean {
  // ⚠ A ROW NOTHING EVER TOUCHED IS NOT A RETRY CANDIDATE, however old it is.
  // Staleness ages a never-attempted row from `created_at` (correctly — it is
  // how a closed tab's cell stops looking pending), but offering RETRY there
  // appends a SECOND live `requested` row for one intended cell, and both are
  // generatable. The correct action on this row is generateCell, on the row that
  // already exists.
  if (row.state === "requested" && row.attemptedAtMs === null) return false;

  const state = cellRenderState(row, serverNowMs, staleAfterMs);

  // ⚠ A BILLED TIMEOUT IS AN IN-FLIGHT CASE WEARING A FAILED ROW'S CLOTHES.
  //
  // ⚠⚠ AND THE GUARD USED TO BE ON THE WRONG CAUSE — it keyed on
  // `failureDetail === "caller_aborted"`, which the Unit 2 taxonomy classifies as
  // NOT billed, while `adapter_timeout` — billed BY DEFINITION, because our own
  // AbortSignal fired and the vendor was still working — fell through and was
  // instantly retryable. The reasoning quoted for the guarded case was strictly
  // MORE true of the unguarded one. The reproduction: gpt-image-2 aborts at 240s,
  // the row lands `failed / timeout / adapter_timeout / billed=true / $0.21`,
  // Retry lights up at once, the staff member clicks, and the original call
  // completes and bills. Two charges, one intent — which is the whole thing the
  // staleness window exists to prevent.
  //
  // So the rule is the CLASS, not the detail: any `failed` row that we believe
  // cost money on a call that may still be running is held until staleness.
  // `billed === true` is the "we may have paid" half and `timeout` is the "it may
  // still be running" half; a `provider_error` or a `safety_blocked` is a settled
  // answer from the vendor and stays immediately retryable.
  if (state === "failed" && row.billed === true && row.failureReason === "timeout") {
    return isImageStale(row, serverNowMs, staleAfterMs);
  }

  return state === "done" || state === "failed" || state === "stale";
}

/**
 * The clock offset a receiving client should hold, and how it reads its own.
 *
 * ⚠ EXTRACTED HERE RATHER THAN WRITTEN INLINE IN THE COMPOSER, and the sign is
 * the reason: `offset = serverNow - localNow` added back to a later `Date.now()`
 * reconstructs the server's clock; the same subtraction the other way round
 * DOUBLES a browser's error. Getting it backwards on a laptop fifteen minutes
 * fast offers Retry on a vendor call that is still running — paying twice — and
 * there is no jsdom in this suite, so an arithmetic slip inside `.tsx` is a slip
 * CI cannot see.
 */
export function clockOffsetFor(serverNowMs: number, receivedAtLocalMs: number): number {
  return serverNowMs - receivedAtLocalMs;
}

export function serverNowFrom(offsetMs: number, localNowMs: number): number {
  return localNowMs + offsetMs;
}

/** The attempt a cell RENDERS and the one Retry acts on: the newest. */
export function newestAttempt<T extends GridAttempt>(cell: GridCell<T>): T {
  return cell.attempts[0]!;
}

/**
 * How many CONSECUTIVE unchanged polls end the loop.
 *
 * ⚠ THE POLL USED TO BE UNBOUNDED, and a run CAN be permanently wedged. A run
 * naming a reference whose OBJECT has gone fails loud before the CAS, so every
 * attempt returns `reference_unavailable` with the cell untouched —
 * `state='requested', attempted_at=NULL`, forever. The reference row cannot be
 * deleted (append-only trigger) and `reference_ids` is snapshotted with no edit
 * path, so nothing repairs it. Meanwhile {@link shouldPollCells} stayed true and
 * the tab re-read the run, its cells and a signed URL per stored image every five
 * seconds indefinitely — and the run id is restored from sessionStorage after a
 * reload, so closing the tab does not end it either.
 *
 * Sized past the whole staleness window (10 minutes at a 5s tick is 120 ticks),
 * because a genuinely pending cell DOES change state at the end of it — the
 * derived `stale` label flips and Retry appears, which counts as a change. What
 * this bound catches is the case where NOTHING moves at all.
 */
export const IMAGE_LAB_MAX_IDLE_POLLS = 150;

/**
 * Should the grid keep polling?
 *
 * True while any attempt is non-final AND the loop has seen something change
 * recently. `idlePolls` is the number of consecutive reads that returned an
 * identical picture; the caller resets it to zero whenever the rows differ.
 */
export function shouldPollCells(
  rows: readonly CellLifecycle[],
  idlePolls: number = 0,
  maxIdlePolls: number = IMAGE_LAB_MAX_IDLE_POLLS
): boolean {
  if (idlePolls >= maxIdlePolls) return false;
  return rows.some((row) => row.state !== "done" && row.state !== "failed");
}

/**
 * A stable fingerprint of what the grid currently shows.
 *
 * Only the fields a reader can SEE change — comparing whole rows would count a
 * re-minted signed URL as a change and make the idle bound unreachable, which is
 * the failure this whole mechanism exists to avoid.
 */
export function cellsFingerprint(
  rows: readonly { id: string; state: string; attemptedAtMs: number | null }[]
): string {
  return rows
    .map((row) => `${row.id}:${row.state}:${row.attemptedAtMs ?? ""}`)
    .sort()
    .join("|");
}

/**
 * The model columns a RUN has, derived from the rows it actually minted.
 *
 * ⚠ NOT THE LIVE CHIP SELECTION. The grid used to take its columns from whatever
 * was selected at render time, so deselecting a model mid-fan erased its live,
 * BILLING cells from the only surface that could show or retry them — and
 * toggling a chip silently reordered the compare columns of a run already
 * recorded.
 */
export function modelIdsFromCells(rows: readonly { modelId: string }[]): string[] {
  return [...new Set(rows.map((row) => row.modelId))];
}

/**
 * The idempotency key for a composition, RESOLVED THROUGH A STORE THAT OUTLIVES
 * THE COMPONENT.
 *
 * ⚠ REACT STATE IS THE WRONG HOME FOR THIS. The two cases the key exists for are
 * "no response, so the staff member reloads" and "…so they open a second tab",
 * and a reload destroys component state — so the resubmit minted a FRESH key,
 * which mints a whole new run whose fresh cell ids all pass their own CAS. Two
 * full 12-cell fans, one intent. Keyed by the composition SIGNATURE so a
 * genuinely different prompt never collides onto the earlier run instead.
 */
export type IdempotencyStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** Forget a key — see {@link releaseIdempotencyKey}. */
  clear(key: string): void;
};

export const IMAGE_LAB_IDEMPOTENCY_PREFIX = "image-lab:idempotency:";

export function idempotencyStorageKey(signature: string): string {
  // A hash rather than the signature itself: a template is up to 8000 characters
  // and sessionStorage keys are not a place to park a child's slot values.
  return `${IMAGE_LAB_IDEMPOTENCY_PREFIX}${hashSignature(signature)}`;
}

/** FNV-1a, as hex. Not a security primitive — a stable short name for a string. */
export function hashSignature(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function resolveIdempotencyKey(
  store: IdempotencyStore,
  signature: string,
  mint: () => string
): string {
  const storageKey = idempotencyStorageKey(signature);
  const held = store.get(storageKey);
  if (held !== null && held !== "") return held;
  const minted = mint();
  store.set(storageKey, minted);
  return minted;
}

/**
 * Forget a signature's key ONCE THE RUN IT MINTED IS CONFIRMED PERSISTED.
 *
 * ⚠ WITHOUT THIS, THE SAME PROMPT COULD NEVER BE RUN TWICE IN A SESSION — WHICH
 * IS THE CONSISTENCY DRILL. Nothing ever cleared the stored key (only the
 * run-id key was ever removed), and the signature carries no nonce, so pressing
 * Generate again on an UNCHANGED composition — the standard variance check, and
 * the whole basis of the "this hero sheet across N runs" drill — resent the same
 * key, collided with the unique index, returned the existing run as a duplicate,
 * and fanned ZERO cells. The only escape a staff member finds by experiment is
 * editing the template, which changes the one thing the drill holds constant.
 *
 * ⚠ AND IT IS RELEASED AFTER CONFIRMATION, NEVER BEFORE. The key exists to cover
 * the RESUBMIT WINDOW — "no response after thirty seconds, so reload / open a
 * second tab" — and that window is exactly the span in which we do not yet know
 * whether the run landed. Clearing it any earlier reopens the double-fan the key
 * exists to prevent; clearing it once `createImageLabRun` has ANSWERED (either
 * with a fresh run or with the duplicate it collided onto) is safe, because there
 * is no longer an unanswered request for a second submit to duplicate.
 */
export function releaseIdempotencyKey(store: IdempotencyStore, signature: string): void {
  store.clear(idempotencyStorageKey(signature));
}

/**
 * A cell of the compare grid: every attempt at one `(model, ordinal)` position,
 * NEWEST FIRST.
 *
 * Retry appends a row rather than mutating one (append-only history, per-attempt
 * cost), so a 4-candidate run with one retry is FIVE rows that only
 * `(model_id, cell_ordinal)` can reassemble into "which cell was retried".
 */
/** The minimum {@link buildGrid} needs to place and order an attempt. */
export type GridAttempt = {
  readonly id: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  readonly createdAtMs: number;
};

export type GridCell<T extends GridAttempt = CellRow> = {
  readonly modelId: string;
  readonly cellOrdinal: number;
  /** Newest attempt first. Never empty. */
  readonly attempts: readonly T[];
  readonly attemptCount: number;
};

/**
 * Group image rows into grid cells, newest attempt on top.
 *
 * ⚠ SORTED BY `createdAtMs` WITH THE ROW ID AS THE TIE-BREAK. Every cell of one
 * run shares a `created_at` byte-for-byte (transaction timestamp), so a
 * comparator that only reads the timestamp gives the runtime's sort a free hand
 * over which of two attempts is "newest" — and the grid would show a stale
 * attempt on top after a re-render with no data change.
 */
export function buildGrid<T extends GridAttempt>(
  rows: readonly T[],
  modelIds: readonly string[]
): GridCell<T>[] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.modelId}\u0000${row.cellOrdinal}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const cells: GridCell<T>[] = [];
  // Column order is the RUN's model order, not the rows' — a model whose every
  // cell failed must still hold its column, or the grid silently re-flows and
  // two runs of "the same" compare become incomparable.
  const columns =
    modelIds.length > 0 ? modelIds : [...new Set(rows.map((r) => r.modelId))];
  for (const modelId of columns) {
    const ordinals = [
      ...new Set(rows.filter((r) => r.modelId === modelId).map((r) => r.cellOrdinal)),
    ].sort((a, b) => a - b);
    for (const cellOrdinal of ordinals) {
      const attempts = [...(byKey.get(`${modelId}\u0000${cellOrdinal}`) ?? [])].sort(
        (a, b) =>
          b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      );
      if (attempts.length > 0) {
        cells.push({ modelId, cellOrdinal, attempts, attemptCount: attempts.length });
      }
    }
  }
  return cells;
}

// ── Storage keys ─────────────────────────────────────────────────────────────

/** The prefix generated images live under. `references/` is Unit 4's; keeping the
 *  two populations separable is what lets a bucket listing or a sweeper tell an
 *  orphaned generation from a character sheet. */
export const IMAGE_LAB_RUN_PREFIX = "runs";

/**
 * Where one generated image lives: `runs/{run_id}/{image_id}`.
 *
 * ⚠ DETERMINISTIC, AND NO EXTENSION. Both halves are deliberate:
 *   * DETERMINISTIC means an orphan NAMES ITSELF. The key is derivable from ids
 *     that exist BEFORE the vendor call, so a crash between the storage put and
 *     the finalize UPDATE leaves a row still pointing at its own object, and a
 *     sweeper can reconstruct candidates for any non-`done` row. A random key
 *     would make that same crash produce bytes nothing in the database names.
 *   * NO EXTENSION because the content type lives on the row AND on the object.
 *     An extension derived from a type would be a third, weaker claim about the
 *     same fact — and the row's type is sniffed from the bytes, so it is the only
 *     one with any evidence behind it.
 */
export function runObjectKey(runId: string, imageId: string): string {
  return `${IMAGE_LAB_RUN_PREFIX}/${runId}/${imageId}`;
}

/**
 * Signed-URL lifetime for a generated image, matching the reference library's
 * ten minutes. Short on purpose: the bucket is private, every listing mints
 * fresh, and a long-lived bearer URL sitting in an RSC payload and a browser
 * cache buys nothing a re-list does not.
 */
export const IMAGE_LAB_RESULT_URL_TTL_SECONDS = 10 * 60;

// ── The audit breadcrumb ─────────────────────────────────────────────────────

/**
 * What one generation call is allowed to write to the operator log (origin R12).
 *
 * ⚠ THE TYPE IS THE ENFORCEMENT. There is no `prompt`, no `slotValues`, no
 * `template`, no child name and no vendor message on this record — so a line that
 * carried one would be a compile error rather than a code-review miss. What is
 * here is the operational minimum: WHO spent money, WHEN, on WHICH model, over
 * how many cells, and whether the prompt was built from a real child's content
 * (the one fact a consent audit needs and the one it cannot recover afterwards).
 */
export type GenerationBreadcrumb = {
  readonly staffId: string;
  readonly atIso: string;
  readonly modelId: string;
  /** Cells in the RUN this call belongs to — the fan a reader is judging. */
  readonly cellCount: number;
  /** Was any slot value read out of the database? (Never WHICH value.) */
  readonly usedDbContent: boolean;
  readonly outcome: string;
  readonly billed: boolean;
};

export function formatGenerationBreadcrumb(entry: GenerationBreadcrumb): string {
  return (
    `[image-lab/generate] staff=${entry.staffId} at=${entry.atIso} ` +
    `model=${entry.modelId} runCells=${entry.cellCount} ` +
    `dbContent=${entry.usedDbContent} outcome=${entry.outcome} billed=${entry.billed}`
  );
}

// ── The composer's own decisions ─────────────────────────────────────────────

export type ComposerNotice = { readonly tone: "ok" | "warn" | "bad"; readonly text: string };

/**
 * The composer's section order, ONE COLUMN, IDENTICAL AT BOTH BREAKPOINTS.
 *
 * Exported as data and RENDERED BY MAPPING OVER IT, so the order is structurally
 * derived from a tested constant rather than from the sequence somebody happened
 * to paste the JSX in. There is no jsdom in this suite; a source scan asserting
 * "the preview appears after the slots" is the kind of test Unit 4's review
 * defeated nine times over.
 *
 * The order is the WORKFLOW: author the template, fill the slots, READ WHAT WILL
 * BE SENT, attach references, choose models and count, see the price, generate.
 * The resolved-prompt preview sits before every irreversible control on purpose —
 * it is the last human check on child-authored text leaving for a vendor.
 */
export const IMAGE_LAB_COMPOSER_SECTIONS = [
  "template",
  "slots",
  "preview",
  "references",
  "models",
  "generate",
  "results",
] as const;
export type ImageLabComposerSection =
  (typeof IMAGE_LAB_COMPOSER_SECTIONS)[number];

/**
 * THE PREVIEW, AS DATA — one row per model, each holding the exact string that
 * model will be sent.
 *
 * ⚠ THIS FUNCTION IS THE PREVIEW. The composer renders what it returns and
 * computes nothing of its own, which is what makes "the preview equals the string
 * actually dispatched" a testable claim in a suite with no jsdom: the test asserts
 * `previewRows(decision)` against the `resolved_prompt` `createRun` puts on the
 * image rows. A `.tsx` that re-derived the text inline would put the one surface
 * the header calls "the last check before child-authored content leaves for a
 * vendor" outside every test in the repo.
 *
 * Empty in → one explanatory row, never a blank box.
 */
export type PromptPreviewRow = {
  readonly modelId: string;
  readonly text: string;
  readonly derived: boolean;
  /** Why this row reads the way it does — "" when there is nothing to say. */
  readonly note: string;
};

export function previewRows(decision: RunCompositionDecision): PromptPreviewRow[] {
  const copy = IMAGE_LAB_RUN_COPY.composer.preview;
  if (!decision.ok) return [];
  return decision.modelIds.map((modelId) => {
    const prompt = decision.promptByModel[modelId] ?? {
      text: decision.resolved.text,
      derived: false,
    };
    return {
      modelId,
      text: prompt.text,
      derived: prompt.derived,
      note: prompt.derived
        ? findModelEntry(modelId)?.provider === "openai"
          ? copy.derivedRequired
          : copy.derivedChosen
        : "",
    };
  });
}

/**
 * The single string the preview shows when no model is selected yet — the run's
 * authored resolution, which is what a model WOULD get on the `authored` default.
 */
export function previewPromptText(decision: RunCompositionDecision): string {
  return decision.ok
    ? decision.resolved.text
    : IMAGE_LAB_RUN_COPY.composer.preview.empty;
}

export type GenerateAffordance = {
  readonly enabled: boolean;
  /** Warnings that do NOT block. Rendered above the button. */
  readonly warnings: readonly string[];
  /** The one blocking reason, when there is one. */
  readonly blocker: string | null;
  readonly label: string;
};

/**
 * Whether Generate may be pressed, and what the staff member is told first.
 *
 * ⚠ UNFILLED SLOTS WARN, THEY DO NOT BLOCK (plan: warn-not-block). Blocking would
 * make a deliberate template test impossible, and the literal token is what gets
 * sent — which the preview above the button already shows verbatim.
 *
 * The only blockers are inputs that cannot be interpreted at all: no models, no
 * template, a bad count, a prompt past the column's bound.
 */
export function decideGenerateAffordance(input: {
  decision: RunCompositionDecision;
  submitting: boolean;
  live: boolean;
}): GenerateAffordance {
  const copy = IMAGE_LAB_RUN_COPY.composer;
  if (!input.decision.ok) {
    return {
      enabled: false,
      warnings: [],
      blocker: describeCompositionRefusal(input.decision),
      label: copy.generate,
    };
  }

  const warnings: string[] = [];
  if (input.decision.resolved.unfilled.length > 0) {
    warnings.push(copy.unfilledSlots(input.decision.resolved.unfilled));
  }
  if (input.decision.resolved.unknown.length > 0) {
    warnings.push(copy.unknownSlots(input.decision.resolved.unknown));
  }
  if (!input.live) warnings.push(copy.generationOff);

  return {
    enabled: !input.submitting,
    warnings,
    blocker: null,
    label: input.submitting ? copy.generating : copy.generate,
  };
}

export function describeCompositionRefusal(refusal: RunCompositionRefusal): string {
  const copy = IMAGE_LAB_RUN_COPY.refusals;
  switch (refusal.reason) {
    case "no_models":
      return copy.noModels;
    case "unknown_model":
      return copy.unknownModel(refusal.modelId);
    case "bad_image_count":
      return copy.badImageCount(refusal.max);
    case "empty_template":
      return copy.emptyTemplate;
    case "template_too_long":
      return copy.templateTooLong(refusal.max);
    case "prompt_too_long":
      return copy.promptTooLong(refusal.max);
    case "too_many_references":
      return copy.tooManyReferences(refusal.max);
    case "unknown_source_child":
      return copy.unknownSourceChild;
    case "idempotency_conflict":
      return copy.idempotencyConflict;
    case "bad_source_id":
      return copy.badSourceId;
    case "bad_source_token":
      return copy.badSourceToken;
    case "unverified_slot_source":
      return copy.unverifiedSlotSource;
    case "content_picker_off":
      return copy.contentPickerOff;
  }
}

/** Every way the generate-cell route can refuse or finish, as one closed set the
 *  grid renders. Kept here (pure) so the client can import it without the SDK. */
export type GenerateCellOutcome =
  | { kind: "done"; imageId: string }
  | { kind: "failed"; imageId: string; reason: ImageLabFailureReason; detail: string | null }
  | { kind: "not_found" }
  | { kind: "not_admitted" }
  | { kind: "already_finalized"; state: ImageLabImageState }
  | { kind: "retry_refused"; retryAfterMs: number }
  /** The row was claimed, the first call never answered, and the window has now
   *  closed. It can NEVER be re-run — `attempted_at` latches it — so the honest
   *  advice is "retry, which appends a new row". The old answer here was
   *  `not_admitted`'s "another request is already generating this cell; wait for
   *  it to finish", which is the opposite of both the truth and the advice. */
  | { kind: "stale_latched" }
  /** Retry was offered on a row nothing has ever attempted. */
  | { kind: "not_attempted" }
  /** A reference this run names could not be read. NOT filed as a vendor
   *  `provider_error`: the cell is untouched, nothing was dialled, and infra
   *  artifacts must stay out of the per-model failure evidence Unit 6 breaks
   *  out. */
  | { kind: "reference_unavailable" }
  | { kind: "run_purged" }
  /** ⚠ THE ONE NON-OVERRIDABLE GATE ({@link decideChildTextGate}) refused this
   *  cell: an OpenAI model, a run with verified child provenance, and a prompt
   *  that is not from the closed derived vocabulary. Nothing was dialled, nothing
   *  was billed, and the cell is UNTOUCHED — deliberately not rewritten, because
   *  a row that reports a prompt it did not send is worse than a refused cell. */
  | { kind: "child_text_gate" }
  /** ⚠ THE SAME GATE, THE OTHER PAYLOAD. An OpenAI cell on a provenance-bearing
   *  run was carrying REFERENCE IMAGES. Named apart from `child_text_gate` so the
   *  two are separable in History: they have different causes (a prompt choice vs
   *  an attached asset) and different fixes, and a single reason would make the
   *  reference case invisible inside the text case's count. */
  | { kind: "child_reference_gate" }
  /** The cell names a model id the registry does not know, so no vendor posture
   *  can be proven for it. It could not have generated anyway. */
  | { kind: "unknown_model_gate" }
  /** The row carries no prompt at all, so it cannot say what it would send.
   *  Unreachable through this feature's insert paths — see {@link CellRow}. */
  | { kind: "prompt_missing" }
  | { kind: "cooldown"; retryAfterMs: number }
  | { kind: "invalid_input" }
  | { kind: "unavailable" };

export function describeGenerateOutcome(outcome: GenerateCellOutcome): string {
  const copy = IMAGE_LAB_RUN_COPY.outcomes;
  switch (outcome.kind) {
    case "done":
      return copy.done;
    case "failed":
      return copy.failed(outcome.reason, outcome.detail);
    case "not_found":
      return copy.notFound;
    case "not_admitted":
      return copy.notAdmitted;
    case "already_finalized":
      return copy.alreadyFinalized;
    case "retry_refused":
      return copy.retryRefused(outcome.retryAfterMs);
    case "stale_latched":
      return copy.staleLatched;
    case "not_attempted":
      return copy.notAttempted;
    case "reference_unavailable":
      return copy.referenceUnavailable;
    case "run_purged":
      return copy.runPurged;
    case "child_text_gate":
      return copy.childTextGate;
    case "child_reference_gate":
      return copy.childReferenceGate;
    case "unknown_model_gate":
      return copy.unknownModelGate;
    case "prompt_missing":
      return copy.promptMissing;
    case "cooldown":
      return copy.cooldown(outcome.retryAfterMs);
    case "invalid_input":
      return copy.invalidInput;
    case "unavailable":
      return copy.unavailable;
  }
}

/** The staleness window in whole minutes, for the disabled-retry copy. Derived
 *  from Unit 1's constant so the number a staff member is told is the number the
 *  rule actually applies. */
export const IMAGE_LAB_STALE_MINUTES = Math.round(IMAGE_LAB_STALE_AFTER_MS / 60_000);

/** Whole minutes, rounded UP — "wait 0 minutes" is worse than waiting. */
export function minutesFromMs(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/**
 * The per-model line the composer shows before spending anything.
 *
 * NAMES THE FIXED TIER. Quality is not a run setting in v1 (`run-core.ts`'s
 * header says why: an unstored run setting makes the cost evidence
 * unreproducible), so every cell dials `qualityDefault` — and a bench that
 * advertised a high/low choice it does not offer is a bench whose price line
 * cannot be trusted either.
 */
/**
 * The open capability questions on one model, as a sentence — or "" when there
 * are none.
 *
 * ⚠ `unverifiedItems` HAD NO CALLER, while its docblock claimed it drove "an
 * honest badge on the bench". It is worth mounting rather than downgrading: the
 * `personGeneration` allowlist gates TWO OF THE THREE launch models and the
 * gpt-image-2 reference-carriage question gates the third, and either one makes a
 * model look worse in exactly the head-to-head this bench exists to run. A staff
 * member choosing a model deserves to see that before they spend.
 *
 * Pure, and tested here, because the composer cannot be rendered by this suite.
 */
export function describeUnverified(entry: ImageLabModelEntry): string {
  const open = unverifiedItems(entry);
  return open.length === 0 ? "" : IMAGE_LAB_RUN_COPY.composer.modelUnverified(open);
}

export function modelSummaryLine(entry: ImageLabModelEntry): string {
  const price = estimatedCostUsd(entry, null);
  return price === null
    ? IMAGE_LAB_RUN_COPY.composer.modelUnpriced(entry.id)
    : IMAGE_LAB_RUN_COPY.composer.modelPriced(
        entry.id,
        formatUsd(price),
        entry.qualityDefault
      );
}

// ── Copy ─────────────────────────────────────────────────────────────────────

/**
 * ALL user-facing run-flow strings, in ONE constant (the `shell-rules` /
 * `reference-rules` precedent). Copy lives beside the rules that choose between
 * copies, so an outcome can never be rendered by a string the decision does not
 * know about.
 */
export const IMAGE_LAB_RUN_COPY = {
  composer: {
    heading: "Compose a run",
    intro:
      "The editor always holds the {{slot}} template. Values fill a separate panel, and the preview below shows the exact text that will be sent — that preview is the last check before child-authored content leaves for a vendor.",

    template: {
      label: "Prompt template",
      hint: `Use {{product}}, {{oneLiner}}, {{pitch}}, {{sale}}. Up to ${IMAGE_LAB_TEMPLATE_MAX_CHARS} characters.`,
      placeholder:
        "A bright comic panel: a young founder holding {{product}}. Caption: {{oneLiner}}",
    },

    slots: {
      heading: "Slot values",
      show: "Show slot values",
      hide: "Hide slot values",
      /**
       * ⚠ IT TEACHES THE RULE, NOT JUST THE PERMISSION. Hand-typed slot values
       * are allowed — composing a synthetic test case is core bench work — but
       * only under the attestation, because a hand-typed slot value and a
       * replayed child's are the same POST and nothing on the server can tell
       * them apart. Without the attestation `unverified_slot_source` refuses
       * them, on every deployment (the picker flag is deliberately NOT in that
       * condition; turning it off must never widen what is allowed).
       */
      manualHint:
        "Type values by hand, or fill them from a child's real business content. Hand-typed values need the no-child-content box ticked below — without it this bench cannot tell your wording from a replay of a child's, so it refuses them.",
      /** ⚠ NEVER a blank. A privacy exclusion that renders as an empty field is
       *  indistinguishable from a missing value, and a staff member fills it in
       *  by hand — reintroducing exactly what the exclusion removed. */
      excludedChip: "excluded",
      excludedNote: (field: string, why: string) => `${field} — ${why}`,
    },

    preview: {
      heading: "Resolved prompt",
      hint: "Read-only. Edit the template or the slot values above to change it.",
      empty: "Nothing to send yet — write a template first.",
      /** ⚠ ONCE A RUN EXISTS THE PREVIEW STOPS DESCRIBING WHAT GETS SENT. Retry
       *  sends the RUN's stored prompt, while the preview tracks the live
       *  template — and this surface's own header calls the preview "the last
       *  check before child-authored content leaves for a vendor", which makes
       *  an unlabelled preview the worst possible lie to ship. Both are shown,
       *  and both say which is which. */
      nextRunHeading: "Resolved prompt — the NEXT run",
      nextRunHint:
        "A run already exists below. This is what pressing Generate would send now; the run's own prompt is shown with its results.",
      sentHeading: "The run's authored prompt",
      /**
       * ⚠ IT USED TO SAY "Retry re-sends exactly this", AND THAT IS FALSE IN THE
       * DIRECTION THAT CAUSES A WRONG ESCALATION.
       *
       * The string rendered beneath this heading is `run.resolvedPrompt` — the
       * AUTHORED resolution, template × slot values, i.e. the child's own words.
       * It is present on EVERY run, including a run composed precisely so that
       * every OpenAI cell sent the derived vocabulary instead. Meanwhile
       * `retryCell` carries forward the CELL's own prompt, not this one. So the
       * surface a human uses to verify the gate worked was displaying the child's
       * prose labelled as what would be re-sent, on a run where it had never been
       * sent and never would be.
       */
      sentHint:
        "Stored evidence of what this run resolved to, not a record of what was dispatched. The prompt is chosen per model, so each attempt's own text is on its card below — and a retry re-sends that card's text, not this.",

      /** The per-model preview — one block per selected model, because the text
       *  is a per-model choice and a single box could only ever show one of
       *  them. */
      perModelHeading: "What each model will be sent",
      perModelHint:
        "Read-only, and exact. The prompt is chosen per model on purpose — finding that one model needs different wording is a result, not a problem.",
      modeLabel: "Prompt text",
      modeAuthored: "Template + slot values (as written)",
      modeDerived: "Category-derived (no child wording)",
      derivedBadge: "Derived",
      authoredBadge: "As written",
      /** ⚠ NAMES THE VENDOR RULE, not our preference. */
      derivedRequired:
        "Required on this model: OpenAI's under-18 API guidance bars processing an under-13's personal data without zero data retention, which we do not have. This prompt is built from a closed category vocabulary and carries none of the child's wording.",
      derivedChosen:
        "Chosen for this model. Nothing requires it here — the Gemini paid tier does not train on prompts and has no under-18 processing bar — so this is an experiment, not a restriction.",
      lockedNote:
        "This model cannot send the child's wording while the run carries child provenance, so the choice is fixed.",
      /** The same lock, the OTHER cause — and it names the box that lifts it,
       *  because a lock with no stated escape is the trap this replaced. */
      lockedUnattestedNote:
        "This run has not been attested free of child-authored content, so this model is fixed to the category-derived prompt. Tick the box above to send your own wording here.",
    },

    /** ⚠ THE ATTESTATION. See {@link PromptGateContext} for why it defaults off. */
    attestation: {
      label: "The template and slot values below are my own wording — no child wrote any of it.",
      hint: "Leave this unticked if you are unsure. Unticked, OpenAI models send the category-derived prompt instead of your text, and hand-typed slot values are refused; Google models are unaffected either way. What you tick is recorded on the run against your staff id.",
      lockedByProvenance:
        "This run was filled from a child's business content, so OpenAI models derive regardless of what is ticked here.",
    },

    models: {
      heading: "Models",
      hint: "Pick one, or several to fan the identical input across them.",
      compareOn: "Compare: the same prompt goes to every selected model.",
      compareOffSingle:
        "One model selected — this is recorded as a normal run, not a comparison.",
      countLabel: "Candidates per model",
      costLine: (total: string, cells: number) =>
        `${cells} cell${cells === 1 ? "" : "s"} · about ${total} at list price.`,
    },

    generate: "Generate",
    generating: "Generating…",
    generationOff:
      "IMAGE_LAB_LIVE is not set to 1 or true, so the run will be recorded but every cell will finish as unconfigured and nothing will be billed.",
    unfilledSlots: (slots: readonly string[]) =>
      `${slots.join(", ")} ${slots.length === 1 ? "has" : "have"} no value, so the literal {{slot}} text will be sent. That is allowed — generate anyway if it is deliberate.`,
    unknownSlots: (slots: readonly string[]) =>
      `${slots.join(", ")} ${slots.length === 1 ? "is not a slot" : "are not slots"} this bench fills. The literal text will be sent.`,
    modelPriced: (id: string, price: string, tier: string) =>
      `${id} — about ${price} per image at the fixed ${tier} tier.`,
    modelUnpriced: (id: string) => `${id} — no price for its default tier.`,
    /** ⚠ NAMES THE OPEN QUESTIONS, because a caveat that lives only in a
     *  planning doc cannot reach the person choosing the model. */
    modelUnverified: (items: readonly string[]) =>
      `Unverified: ${items.join(", ")} — results on this model may reflect our own open questions rather than the model.`,
  },

  picker: {
    heading: "Fill from a child's business",
    disabled: {
      headline: "The content picker is off.",
      /** Two flags, two jobs, and the notice says which is which — an operator
       *  reading "the picker is off" while generation works needs to know it is
       *  not the same switch. */
      body:
        "IMAGE_LAB_REAL_CONTENT_LIVE is not set to 1 or true, so no child's business content can be loaded into the slots. Manual prompts still generate normally; this flag is the technical enforcement of the consent and provider-terms check, and is set only after that check completes.",
    },
    childLabel: "Child",
    ideaLabel: "Idea",
    load: "Fill slots",
    loading: "Loading…",
    noChildren: "No children with business content yet.",
    noIdeas: "That child has no ideas saved, so every slot comes back empty.",
    /** ⚠ ITS OWN MESSAGE, not "no ideas saved". A doc the version gate refused is
     *  a doc we DECLINED to read — and telling a staff member the child has
     *  nothing saved invites them to type the content in BY HAND, which is
     *  exactly the path that bypasses the scrub. */
    docGated:
      "That child's saved work is in a format this bench does not read, so nothing was loaded. Do not retype it by hand — the name scrub only runs on content this bench loads itself.",
    scrubNote:
      "The child's first name and username are removed from every slot value before the prompt is built, and again on the server before anything is sent. The buyer's name is never read at all.",
    /** ⚠ NEVER claim a protection that did not run. */
    scrubNotCovered:
      "This child's roster first name produced no scrubbable token, so the name scrub could not remove it. Read every slot value below before generating.",
    unknownIdea:
      "That idea is no longer in the child's saved work — it was edited or removed since this list loaded. Nothing was filled; pick again from the refreshed list.",
    substituted:
      "No idea was chosen, so the first one was used. The picker now shows which one the run will record.",
    emptySlots: (slots: readonly string[]) =>
      `${slots.join(", ")} came back empty for this child.`,
    filled: "Slots filled from the child's saved work.",
    unavailable: "That content could not be loaded. Nothing was changed.",
  },

  grid: {
    heading: "Results",
    empty: "No cells yet. Compose a run above and the grid appears here — before any model is called.",
    state: {
      requested: "Queued",
      pending: "Generating…",
      stale: "No answer",
      done: "Done",
      failed: "Failed",
    } as Record<CellRenderState, string>,
    attemptBadge: (count: number) => `${count} attempt${count === 1 ? "" : "s"}`,
    /** The ONE numbering phrase — see {@link describeAttemptNumbering}. Used by
     *  the accessible name and by the visible line, which used to disagree by
     *  being written twice. */
    attemptOrdinal: (index: number, of: number) => `attempt ${index} of ${of}`,
    attemptEarlier: " (earlier)",
    /**
     * The live-region sentence (see {@link describeCellProgress}). Lower case and
     * verb-shaped, because these are read INSIDE a sentence rather than as the
     * card labels above — "4 done, 2 generating" rather than "4 Done, 2
     * Generating…", and no ellipsis for a screen reader to spell out.
     */
    progressState: {
      requested: "queued",
      pending: "generating",
      stale: "with no answer yet",
      done: "done",
      failed: "failed",
    } as Record<CellRenderState, string>,
    progress: (total: number, parts: readonly string[]) =>
      `${total} attempt${total === 1 ? "" : "s"}: ${parts.join(", ")}.`,
    retry: "Retry",
    /** A never-attempted row's correct action is to GENERATE the row that already
     *  exists, not to append a second live one beside it. */
    generate: "Generate this cell",
    generateHint:
      "Nothing has been sent for this cell yet. This generates the row that already exists — it does not add a second one.",
    /** The run's stored AUTHORED resolution, shown beside the results — see
     *  `preview`. The per-cell text is on each card. */
    sentPromptHeading: "The run's authored prompt",
    /**
     * ⚠ PER ATTEMPT, because the prompt is per model. A run-level line was the
     * right shape only while every cell shared one string.
     *
     * ⚠ AND IT IS A FUNCTION OF THE LIFECYCLE, NOT A CONSTANT. It read "Prompt
     * sent" unconditionally over `resolved_prompt` — which is written at COMPOSE
     * time, before dispatch. A gate-refused cell returns BEFORE the CAS, so it
     * sits at `state='requested'` with `attempted_at` null, holding the text, and
     * rendered as "Prompt sent" with the child's pitch beneath it for a call that
     * was never dialled and never billed. Every freshly composed cell said the
     * same. `attempted_at` is the only fact that distinguishes them.
     */
    cellPromptHeading: (attempted: boolean) => (attempted ? "Prompt sent" : "Prompt to send"),
    cellPromptDerived: "Category-derived",
    cellPromptAuthored: "As written",
    cellPromptMissing:
      "This attempt has no recorded prompt. Nothing this bench writes can produce that — report it.",
    /** ⚠ THE HONEST WARNING. `failed → done` is a real transition: a function we
     *  killed can have its vendor call complete afterwards and finalize over the
     *  failure. Staff must know a retry can end up beside a late success. */
    retryWarning:
      "A retry adds a new attempt and does not cancel the old one. If the first call finishes late, it may still land as a success beside this retry — and both are billed.",
    retryDisabled: (minutes: number) =>
      `Retry opens in about ${minutes} minute${minutes === 1 ? "" : "s"}. Until then the first call may still be running, and retrying pays twice.`,
    billed: "Billed",
    notBilled: "Not billed",
    costLine: (estimated: string | null, reported: string | null) =>
      reported !== null
        ? `${estimated ?? "—"} estimated · ${reported} reported`
        : `${estimated ?? "—"} estimated`,
  },

  refusals: {
    noModels: "Pick at least one model. A run with no cells can never generate.",
    unknownModel: (id: string) => `${id} is not a model this bench knows.`,
    badImageCount: (max: number) => `Choose between 1 and ${max} candidates per model.`,
    emptyTemplate: "Write a prompt template first.",
    templateTooLong: (max: number) => `The template is capped at ${max} characters.`,
    promptTooLong: (max: number) =>
      `The resolved prompt is capped at ${max} characters — shorten the template or the slot values.`,
    tooManyReferences: (max: number) => `A run can carry at most ${max} references.`,
    unknownSourceChild:
      "The child this run says it was built from is not one this bench may read. Nothing was written and nothing was sent — re-pick the child and fill the slots again.",
    idempotencyConflict:
      "This submission reuses the key of a run built from a DIFFERENT prompt, so it was refused rather than answered with that run. Change something, or reload the bench to start a fresh compose.",
    badSourceId:
      "The idea or task id on this submission is not a shape this bench records. Fill the slots from the picker again rather than editing the request.",
    /** ⚠ NEVER "we ignored it and carried on". A token that does not verify is a
     *  refusal, because the alternative — falling through to the unprovenanced
     *  path — is the exact bypass the token replaces. */
    badSourceToken:
      "The provenance on this submission could not be verified, or it has expired, so nothing was written and nothing was sent. Fill the slots from the picker again — the token is minted server-side and cannot be edited or reused across a long gap.",
    /** ⚠ IT MUST NOT NAME THE TEMPLATE AS THE WAY ROUND THIS. This copy used to
     *  end "…or put the wording straight into the template instead", which is a
     *  printed instruction for the exact bypass the attestation now closes: the
     *  template was never examined by this refusal, was not scrubbed without
     *  tokens, and left `source_child_id` null so no provenance-keyed defence
     *  fired. The product must not point at its own door. */
    unverifiedSlotSource:
      "Slot values were submitted without the server-signed provenance the picker mints, so this bench cannot tell them from a replay of a child's text. Fill the slots from the picker instead — and if the wording is your own, say so with the no-child-content box rather than routing it around this check.",
    contentPickerOff:
      "This submission claims it was built from a child's business content, but IMAGE_LAB_REAL_CONTENT_LIVE is not set — so no child content may be read or recorded on this deployment. Nothing was written and nothing was sent.",
  },

  outcomes: {
    done: "Generated.",
    failed: (reason: ImageLabFailureReason, detail: string | null) =>
      detail ? `${reason}: ${detail}` : reason,
    notFound: "That cell no longer exists.",
    notAdmitted:
      "Another request is already generating this cell, so nothing was sent. Wait for it to finish.",
    alreadyFinalized: "That cell is already finished — nothing was sent.",
    retryRefused: (retryAfterMs: number) =>
      `That cell may still be generating. Retry opens in about ${minutesFromMs(retryAfterMs)} minute${minutesFromMs(retryAfterMs) === 1 ? "" : "s"}.`,
    /** ⚠ THE OPPOSITE OF WHAT THIS USED TO SAY. A latched row past the window
     *  reported `not_admitted` — "another request is already generating this
     *  cell, wait for it to finish" — which is untrue and points at the one
     *  action that cannot work. `attempted_at` is set, so this row's CAS can
     *  never admit anything again. */
    staleLatched:
      "That cell's first call never answered, and the row is latched — it can never be re-run. Retry adds a NEW attempt beside it; if the first call finishes late, both are billed.",
    notAttempted:
      "Nothing has ever been sent for that cell, so there is nothing to retry — Generate it instead. (Retrying would leave two live rows for one intended image, and both would generate.)",
    referenceUnavailable:
      "A reference image this run needs could not be read, so nothing was sent and the cell is untouched. This is a storage fault, not a model result — it is deliberately kept out of the per-model failure evidence.",
    runPurged:
      "That run was deleted while this cell was generating, so the image was discarded.",
    /** ⚠ REFUSED, NOT REWRITTEN — and the copy says which, because a staff member
     *  who believed we had quietly fixed it for them would go on composing runs
     *  that silently sent something other than what the bench displayed. */
    childTextGate:
      "This cell targets an OpenAI model on a run that either was built from a child's business content or was not attested as free of it, and the prompt it carries is not the category-derived one. Nothing was sent and nothing was billed — the cell was refused rather than rewritten, so the row cannot end up reporting a prompt it did not use. Compose again: either tick the no-child-content box, or leave this model on the category-derived prompt. (OpenAI's under-18 API guidance bars processing an under-13's personal data without zero data retention, which is approval-gated and which we do not have. Google models are unaffected.)",
    /** ⚠ NAMES THE REFERENCE, NOT THE PROMPT. A staff member told "the prompt was
     *  refused" about an attached PNG would go and change the prompt. */
    childReferenceGate:
      "This cell targets an OpenAI model on a run built from a child's business content, and it carries reference images. Reference images are staff uploads this bench cannot inspect — a photo of a hand-lettered stand sign carries handwriting, a business name and possibly a likeness, which is exactly what the category-derived prompt beside it is stripping out. Nothing was sent and nothing was billed. Remove the references from this run, or send this cell to a Google model instead — Google is unaffected.",
    unknownModelGate:
      "This cell names a model this bench no longer knows, so nothing can be proven about where its data would go. Nothing was sent and nothing was billed. Compose again with a model from the list.",
    promptMissing:
      "This cell has no recorded prompt, so it cannot say what it would send. Nothing was sent and nothing was billed. This should be impossible — report it rather than retrying.",
    cooldown: (retryAfterMs: number) =>
      `Too many generations in a short window. Try again in about ${minutesFromMs(retryAfterMs)} minute${minutesFromMs(retryAfterMs) === 1 ? "" : "s"}.`,
    invalidInput: "That request was not understood, so nothing was sent.",
    unavailable: "The bench is unreachable right now. Nothing was sent.",
  },

  runCreated: "Run created. Every cell is recorded before anything is sent.",
  runDuplicate:
    "That compose was already submitted — showing the existing run rather than paying for a second one.",
} as const;
