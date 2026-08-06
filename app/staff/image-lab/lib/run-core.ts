/**
 * Image Lab — the run flow's SEQUENCING, against injected deps
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R3, R5, R7, R17).
 *
 * PLAIN module — no next/supabase/react imports. Every I/O touch arrives on
 * {@link RunDeps}, so the two sequences below are exercised against in-memory
 * fakes (`__tests__/run-core.test.ts`) — including the CAS RACE, which a real
 * database could not be asked to reproduce on demand. `run-loader.ts` builds the
 * real deps from `imageLabDb()`; `run-actions.ts` and the generate-cell route are
 * the wire and hold the gate.
 *
 * ── THE TWO SEQUENCES, AND WHY THE ORDER IS THE WHOLE DESIGN ───────────────
 *
 * 1. CREATE RUN — persist, then answer. The run row and one image row per cell
 *    are written BEFORE anything is sent anywhere. Intent is stamped before the
 *    effect (docs/solutions/logic-errors/an-external-already-exists-cannot-tell-
 *    mine-from-foreign-stamp-intent-before-the-effect-2026-07-29.md), so a crash
 *    mid-generation leaves a row that says what was attempted rather than a paid
 *    call nothing recorded.
 *
 * 2. GENERATE CELL — CAS, then dial. Nothing reaches a vendor until an atomic
 *    conditional UPDATE has claimed the row.
 *
 * ── TWO DIFFERENT DOUBLE-SPEND DEFENCES, AND THEY DO NOT SUBSTITUTE ────────
 * This is the single most important thing in this module, and it is easy to get
 * wrong by believing one guard covers both cases:
 *
 *   * THE PER-CELL CAS protects a cell that ALREADY EXISTS. Two tabs, an
 *     impatient double-click, a retry fired at a running call — all of them name
 *     the same image id, and exactly one wins the conditional UPDATE.
 *
 *   * THE RUN'S IDEMPOTENCY KEY protects the case people actually hit: no
 *     response after thirty seconds, so the staff member reloads the POST or
 *     opens a second tab and composes again. That mints a WHOLE NEW RUN with
 *     FRESH image ids, and every one of those ids passes its own CAS cleanly.
 *     The CAS cannot see this at all. The `(staff_id, idempotency_key)` unique
 *     index is what does — the client mints the key ONCE per compose, and a
 *     resubmit collides and gets the existing run back.
 *
 * Delete either and the other still passes every test it was written for, which
 * is precisely why both have their own named test.
 *
 * ── QUALITY IS NOT A RUN SETTING IN v1, AND THAT IS DELIBERATE ─────────────
 * `fp_image_lab_runs` has no `quality` column. An unstored run setting would make
 * the cost evidence unreproducible — History would show a price it could not
 * justify — so every cell dials the registry's `qualityDefault` for its model
 * (gpt-image-2: medium) and the estimate is computed from the same value. A
 * quality selector is a column plus a migration, not a form field.
 */

import {
  isBilledOutcome,
  failureReasonForResult,
  type NormalizedImageResult,
} from "./image-model-rules";
import { estimatedCostUsd, findModelEntry } from "./model-registry";
import {
  IMAGE_LAB_STALE_AFTER_MS,
  type ImageLabFailureReason,
  type ImageLabMimeType,
} from "./image-lab-rules";
import {
  canRetryCell,
  decideChildTextGate,
  decideRunComposition,
  formatGenerationBreadcrumb,
  isRecordableSourceId,
  runObjectKey,
  type CellRow,
  type CellSpec,
  type GenerateCellOutcome,
  type PromptModes,
  type RunCompositionRefusal,
  type SlotValues,
} from "./run-rules";
import { nameTokensFor, scrubNames } from "./content-picker-core";
import { isRealFamily } from "@/app/crm/lib/test-family-filter";
import { IMAGE_LAB_SLOTS } from "./image-lab-rules";

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A run row, as this feature reads it back. */
export type RunRow = {
  readonly id: string;
  readonly staffId: string;
  readonly idempotencyKey: string;
  readonly template: string;
  readonly slotValues: SlotValues;
  readonly resolvedPrompt: string;
  readonly referenceIds: readonly string[];
  readonly drillTags: readonly string[];
  readonly note: string;
  readonly compare: boolean;
  readonly iteratedOnModel: string | null;
  readonly iteratedFromRunId: string | null;
  /** Internal ids ONLY — never a name (origin R17, migration header). */
  readonly sourceChildId: string | null;
  readonly sourceIdeaId: string | null;
  readonly sourceTaskId: string | null;
  /**
   * ⚠ THE STAFF ATTESTATION, RECORDED. `staffId` above is who asserted it and
   * `createdAtMs` is when — which is the whole reason it is a column and not a
   * request-scoped boolean. See `run-rules.PromptGateContext`.
   *
   * It is the run-level fact `generateCell`'s gate reads for a run with NO
   * provenance: false (the default, and the value of every run composed by a
   * client that has never heard of this field) means every OpenAI cell must carry
   * the derived vocabulary, exactly as verified provenance does.
   */
  readonly noChildContentAttested: boolean;
  readonly createdAtMs: number;
  /**
   * How many cells this run fanned to — the ONE number the audit breadcrumb
   * reports about the shape of the spend.
   *
   * Carried on the row rather than counted per generation call: the breadcrumb
   * runs on the paid path once per cell, and `loadRun` already makes a round
   * trip it can ride along with. (The loader fills it with an exact `head`
   * count; `createRun` knows it from the composition it just wrote.)
   */
  readonly cellCount: number;
};

export type NewCellRow = {
  readonly id: string;
  readonly runId: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  /** ⚠ WRITTEN WITH THE ROW, before anything is sent. See {@link CellSpec}. */
  readonly promptText: string;
  readonly promptDerived: boolean;
};

/** The finalize patch. Shaped so the schema's CHECKs cannot be violated by a
 *  caller assembling fields ad hoc — see {@link finalizePatchFor}. */
export type FinalizePatch = {
  readonly imageId: string;
  readonly state: "done" | "failed";
  readonly storageKey: string | null;
  readonly contentType: ImageLabMimeType | null;
  readonly failureReason: ImageLabFailureReason | null;
  readonly failureDetail: string | null;
  readonly billed: boolean;
  readonly costEstimatedUsd: number | null;
  readonly costReportedUsd: number | null;
  readonly gatewayGenerationId: string | null;
};

export type RunDeps = {
  /** A fresh v4 uuid. Ids are minted HERE rather than defaulted in Postgres so
   *  the storage key is derivable before the insert even returns. */
  newId(): string;
  /** The SERVER's clock — the same one that stamps `attempted_at`. Never the
   *  browser's (see `isImageStale`'s warning about a suspended laptop). */
  now(): number;

  insertRun(
    row: RunRow
  ): Promise<{ ok: true; run: RunRow } | { ok: false; reason: "duplicate_key" }>;
  /** The resubmit path's re-read, on the unique index's own columns. */
  findRunByIdempotency(staffId: string, key: string): Promise<RunRow | null>;
  loadRun(runId: string): Promise<RunRow | null>;

  insertCells(rows: readonly NewCellRow[]): Promise<CellRow[]>;
  listCells(runId: string): Promise<CellRow[]>;
  loadCell(imageId: string): Promise<CellRow | null>;

  /**
   * THE ATOMIC CAS:
   *   update … set attempted_at = now()
   *    where id = $1 and state = 'requested' and attempted_at is null
   *    returning *
   * Returns the row on success, NULL when zero rows came back — and a null MUST
   * NOT be followed by a vendor call.
   */
  markAttempt(imageId: string): Promise<CellRow | null>;

  loadReferenceBytes(
    ids: readonly string[]
  ): Promise<{ bytes: Uint8Array; contentType: ImageLabMimeType }[]>;

  /**
   * The scrub inputs and the real-family posture for one child, by id.
   *
   * ⚠ THIS IS WHAT MAKES THE NAME SCRUB A PROPERTY OF THE PAID PATH rather than
   * advisory UI behaviour. The scrub used to run ONLY inside `pickSlotValues`,
   * while the prompt that actually reaches a vendor is assembled in `createRun`
   * from CLIENT-SUPPLIED slot values — so a stale tab, a replayed action or a
   * compromised session could POST unscrubbed child prose and still stamp
   * `source.childId` on it. And `source.*` being client-asserted is also what
   * made the consent audit caller-controlled. Both are fixed by looking the
   * child up here, server-side, before a row is written.
   */
  loadChildIdentity(childId: string): Promise<{
    firstName: string;
    lastName: string;
    username: string | null;
    isTest: boolean | null;
  } | null>;

  /**
   * Verify the picker's server-signed provenance token (`./source-token.ts`).
   *
   * ⚠ THIS IS WHAT REPLACED A CLIENT-ASSERTED `source` OBJECT. The chokepoint
   * below used to be guarded by `if (input.source && input.source.childId !==
   * null)` over an OPTIONAL field, so the re-scrub and the consent breadcrumb
   * were both defeated by DELETING a field rather than by forging one. A caller
   * cannot obtain filled slots without also carrying this token, and it cannot
   * mint one.
   *
   * ⚠ IT TAKES THE CALLER'S STAFF ID, AND THE TOKEN IS BOUND TO THE MINTER'S.
   * The signed payload used to be `{c,i,t,at}` — no staff id, no nonce — so one
   * token was replayable for its whole two-hour life by ANY staff session onto
   * ANY compose. That is not a route for child text to reach OpenAI (the token
   * makes the gate STRICTER, never looser); what it corrupts is the CONSENT
   * RECORD. `source_child_id` is what the revocation purge keys on, and a
   * floating token makes it attachable to runs containing none of that child's
   * content — so a purge would delete the wrong rows and leave the right ones.
   */
  verifySourceToken(
    token: string,
    staffId: string
  ): {
    ok: boolean;
    provenance?: { childId: string; ideaId: string | null; taskId: string | null };
  };

  /** Is the consent flag on? Injected so the sequence is testable without env. */
  isRealContentLive(): boolean;

  /**
   * Is `IMAGE_LAB_OPENAI_OPEN_VOCABULARY` on? — the TEXT half of the owner's
   * 2026-08-06 decision: the OpenAI leg takes name-scrubbed child WORDING on the
   * same terms as Gemini. See `isImageLabOpenVocabulary` in
   * `./image-lab-rules.ts` for the decision and its provenance.
   *
   * ⚠ TEXT ONLY — the reference channel is {@link isOpenReferences}, a separate
   * and independent switch.
   *
   * ⚠ INJECTED AND REQUIRED, exactly like {@link isRealContentLive} beside it,
   * for the same two reasons: the sequence stays testable in every flag state
   * without touching `process.env`, and a REQUIRED member means TypeScript names
   * every construction site the day a new one appears. An optional member would
   * make "nobody wired it" indistinguishable from "the operator left it off" —
   * safe, but silently so, which is how a flag ends up dead in production.
   *
   * ⚠ READ PER CALL, NOT CAPTURED. `run-loader` wires it to a function that
   * reads the env var at call time, so flipping the flag takes effect on warm
   * instances too — the same rule the flag readers themselves document.
   */
  isOpenVocabulary(): boolean;

  /**
   * Is `IMAGE_LAB_OPENAI_OPEN_REFERENCES` on? — the REFERENCE-IMAGE half of the
   * same decision, carried separately because the two bets rest on different
   * things: the text bet on a verified technical control (the name scrub), the
   * reference bet on upload-dialog copy alone. See `isImageLabOpenReferences` in
   * `./image-lab-rules.ts`.
   *
   * ⚠ REFERENCES ONLY, AND INDEPENDENT OF ITS SIBLING IN BOTH DIRECTIONS.
   * Required and read per call, for the reasons given above.
   */
  isOpenReferences(): boolean;

  generate(request: {
    modelId: string;
    prompt: string;
    referenceImages?: readonly { bytes: Uint8Array; contentType: ImageLabMimeType }[];
    abortSignal?: AbortSignal;
  }): Promise<NormalizedImageResult>;

  /** ⚠ Receives the EXACT Uint8Array. See the warning at the call site. */
  putObject(key: string, bytes: Uint8Array, contentType: ImageLabMimeType): Promise<void>;
  removeObject(key: string): Promise<void>;

  /** Conditional finalize — matches only a row still `requested`. Returns how
   *  many rows it matched; ZERO is a designed branch, not an error. */
  finalize(patch: FinalizePatch): Promise<{ rowsMatched: number }>;

  /** One line per generation call. Takes a pre-formatted STRING built by the
   *  pure formatter, so there is no shape here into which a prompt could be
   *  passed. */
  audit(line: string): void;
};

// ── Log discipline ───────────────────────────────────────────────────────────

/**
 * What an unknown thrown value is allowed to contribute to a log line.
 *
 * ⚠ NEVER THE ERROR OBJECT, AND NEVER `String(e)`. Two of the errors that reach
 * these catches were not minted by this repo: the AI SDK's `AI_APICallError`
 * carries `requestBodyValues` — THE PROMPT — as an own enumerable property that
 * `console.error` inspects and prints, and postgrest-js/undici throws quote the
 * REQUEST BODY, which for `insertRun` is `template` + `slot_values` +
 * `resolved_prompt`. Either one puts a child's authored text into the operator
 * log, contradicting the discipline `image-model.ts` states explicitly.
 *
 * ⚠ AND A BARE `e.name` IS A POOR DIAGNOSTIC. The realistic faults here are a
 * `TypeError` ("fetch failed", with the real cause on `e.cause`) and a plain
 * `Error`, so a name-only line degrades to the literal string "Error" — which
 * tells an operator nothing at all. The name is therefore paired with a
 * CLOSED-SET classification and, where present, the cause's `code` (`ECONNRESET`,
 * `ETIMEDOUT`, `ENOTFOUND`), which is the field that actually triages.
 */
export type ErrorClass = "timeout" | "network" | "abort" | "unknown";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function classifyError(e: unknown): ErrorClass {
  const name = e instanceof Error ? e.name : "";
  const cause = e instanceof Error ? (e.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const text = `${name} ${code} ${e instanceof Error ? e.message : ""}`.toLowerCase();

  if (name === "AbortError" || text.includes("abort")) return "abort";
  if (name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || text.includes("timeout")) {
    return "timeout";
  }
  if (NETWORK_CODES.has(code) || text.includes("fetch failed") || name === "TypeError") {
    return "network";
  }
  return "unknown";
}

/** The one string any catch in this module may log about a thrown value. */
export function errorName(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const cause = e instanceof Error ? (e.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : null;
  return `${name} class=${classifyError(e)}${code === null ? "" : ` cause=${code}`}`;
}

/** Does this compose carry any slot content at all? See `createRun`'s chokepoint. */
function hasSlotContent(values: SlotValues | undefined): boolean {
  if (!values) return false;
  return IMAGE_LAB_SLOTS.some((slot) => (values[slot] ?? "").trim() !== "");
}

// ── 1. Create a run ──────────────────────────────────────────────────────────

export type CreateRunInput = {
  staffId: string;
  /** ⚠ CLIENT-MINTED, ONCE PER COMPOSE. See the module header. */
  idempotencyKey: string;
  template: string;
  slotValues: SlotValues;
  modelIds: readonly string[];
  imageCount: number;
  referenceIds?: readonly string[];
  drillTags?: readonly string[];
  note?: string;
  iteratedOnModel?: string | null;
  iteratedFromRunId?: string | null;
  /**
   * The picker's SERVER-SIGNED provenance token (origin R17), verbatim.
   *
   * ⚠ NOT A `source` OBJECT ANY MORE. The three ids are DERIVED from this token,
   * so a caller states nothing about which child a run was built from — see
   * `./source-token.ts` for what that closed.
   */
  sourceToken?: string | null;
  /**
   * Per-model prompt choice (`run-rules.PromptModes`).
   *
   * ⚠ ADVISORY, AND SAFE TO BE SO. A caller can ask for `authored` on an OpenAI
   * model and this function will honour it — the row is written, nothing is sent,
   * and {@link generateCell}'s gate refuses the cell at dispatch. The refusal is
   * deliberately NOT moved here: compose is not the threat surface, dispatch is,
   * and a compose-time rewrite would produce rows that misreport their own input.
   */
  promptModes?: PromptModes;
  /**
   * ⚠ THE EXPLICIT STAFF ATTESTATION: "the template and slot values on this
   * compose contain no child-authored content."
   *
   * ABSENT AND FALSE ARE THE SAME ANSWER, AND IT IS THE SAFE ONE. Without it,
   * every OpenAI cell on this run composes — and dispatches — on the closed
   * category vocabulary, exactly as if a provenance token had verified. With it,
   * authored text is allowed to OpenAI and the boolean is written to the run row
   * beside `staff_id`, so the assertion has an owner.
   *
   * This is the field that closes the template door: `sourceChildId` is a fact
   * about the FETCH PATH, so a child's pitch typed into `template` with no token
   * and empty slots armed nothing at all. See `run-rules.PromptGateContext`.
   */
  noChildContentAttested?: boolean;
};

export type CreateRunResult =
  | {
      ok: true;
      run: RunRow;
      cells: CellRow[];
      /** True when this compose collided with one already recorded. */
      duplicate: boolean;
    }
  | { ok: false; refusal: RunCompositionRefusal }
  /** `cooldown` is the composer's own rate limit (`run-actions`), not a refusal
   *  about the composition — minting runs is cheap and redeeming them is not. */
  | { ok: false; reason: "unavailable" | "cooldown" };

/**
 * Persist a compose. NOTHING IS SENT ANYWHERE HERE — this function has no path
 * to `deps.generate` at all, which is a stronger statement than "it does not call
 * it": the ordering test asserts the journal, and the absence of the edge is what
 * makes the assertion durable.
 */
export async function createRun(
  deps: RunDeps,
  input: CreateRunInput
): Promise<CreateRunResult> {
  // ⚠ `=== true`, NOT TRUTHINESS. The field arrives over the wire; anything that
  // is not literally `true` is "the caller did not assert this", which is the
  // safe reading. It is recorded verbatim even on a provenance-bearing run, where
  // it changes nothing — the record is of what the staff member claimed, not of
  // what the server concluded from it.
  //
  // Read BEFORE the chokepoint because the unverified-slot refusal below now
  // consults it: the attestation is a claim about the WHOLE compose, template and
  // slot values alike.
  const attested = input.noChildContentAttested === true;

  // ── THE CHOKEPOINT. Provenance is VERIFIED (not asserted) and the scrub is
  //    RE-RUN here, because this — not the picker — is the last code that
  //    touches the text before it becomes `resolved_prompt` and is sent. ───────
  let tokens: readonly string[] = [];
  let source: {
    childId: string;
    ideaId: string | null;
    taskId: string | null;
  } | null = null;
  const presented =
    typeof input.sourceToken === "string" && input.sourceToken !== ""
      ? input.sourceToken
      : null;

  if (presented !== null) {
    // ⚠ THE CONSENT FLAG GATES THIS LEG TOO, and it did not used to.
    // `IMAGE_LAB_REAL_CONTENT_LIVE` was read ONLY by the picker's entry points
    // and by the composer's render — so with generation on and consent off, a
    // stale tab or a replayed action still drove the service-role `children` /
    // `families` lookup, stamped `source_child_id`, and logged `dbContent=true`
    // on a deployment whose operator believed the switch was off. Both this
    // module's and the picker's docblocks call the flag "the technical
    // enforcement" of the consent check; this is what makes that true.
    if (!deps.isRealContentLive()) {
      return { ok: false, refusal: { ok: false, reason: "content_picker_off" } };
    }

    // ⚠ A TOKEN THAT DOES NOT VERIFY IS A REFUSAL, NEVER A SILENT DOWNGRADE to
    // the unprovenanced path. Falling through would restore the exact bypass the
    // token replaces, reachable by flipping one character.
    const verdict = deps.verifySourceToken(presented, input.staffId);
    if (!verdict.ok || !verdict.provenance) {
      return { ok: false, refusal: { ok: false, reason: "bad_source_token" } };
    }
    const provenance = verdict.provenance;
    // Belt and braces: the signature proves WE minted these ids, the pattern
    // proves they still satisfy today's rule for the columns they land on.
    if (
      !isRecordableSourceId(provenance.ideaId) ||
      !isRecordableSourceId(provenance.taskId)
    ) {
      return { ok: false, refusal: { ok: false, reason: "bad_source_id" } };
    }

    let child: Awaited<ReturnType<RunDeps["loadChildIdentity"]>>;
    try {
      child = await deps.loadChildIdentity(provenance.childId);
    } catch (e) {
      console.error(`[image-lab/run] source child lookup failed: ${errorName(e)}`);
      return { ok: false, reason: "unavailable" };
    }
    // The SAME predicate the picker applies, on the same fail-closed posture: an
    // unknown child or a test family is not a child this bench may build a
    // consent-audited, money-spending run from.
    if (!child || !isRealFamily({ is_test: child.isTest })) {
      return { ok: false, refusal: { ok: false, reason: "unknown_source_child" } };
    }
    tokens = nameTokensFor(child);
    source = provenance;
  } else if (hasSlotContent(input.slotValues) && !attested) {
    // ⚠ NO TOKEN + NON-EMPTY SLOTS + NO ATTESTATION ⇒ REFUSED, ON EVERY
    //   DEPLOYMENT.
    //
    // This is the other half of "`source` must stop being optional in practice".
    // Every slot value this bench serves carries a token, so a compose that
    // presents slot content WITHOUT one is either a replay that stripped the
    // field or a hand-typed value we cannot distinguish from a replay — and the
    // first of those is precisely the "POST unscrubbed child prose and it is
    // stored, sent, and invisible to the purge" case.
    //
    // ⚠ AND THE ATTESTATION IS WHAT TELLS THE TWO APART. It was briefly written
    // without it, which made slots PICKER-ONLY on every deployment forever — a
    // staff member composing a synthetic test case ("dog treats", "a lemonade
    // stand") could no longer fill a slot by hand at all, for any model. That is
    // a capability taken away from the one thing this bench exists to do, and it
    // was being traded against a distinction that does not hold up: the line that
    // matters is ATTESTED vs UNATTESTED, not SLOTS vs TEMPLATE.
    //
    // A hand-typed slot and a replayed child's slot really are the same POST —
    // which is exactly why an unattested one must be refused, and exactly why an
    // attested one is fine. Splitting the two channels would mean one claim ("no
    // child content in this compose") authorized the template but not the slots,
    // which is incoherent and reads as arbitrary to whoever hits it.
    //
    // The P0 property is unchanged: with no token and no attestation, child text
    // ANYWHERE — template or slots — either forces the derived vocabulary on
    // every OpenAI cell or is refused outright. The attestation remains the ONLY
    // way to send authored text to OpenAI without provenance, and it can never
    // override provenance that actually verified.
    //
    // ⚠ THE `isRealContentLive()` CONJUNCT USED TO BE HERE, AND IT WAS INVERTED.
    // It made the refusal conditional on the picker being ON — so turning
    // `IMAGE_LAB_REAL_CONTENT_LIVE` OFF, which is the action an operator takes to
    // mean "stop touching child content", REMOVED the only refusal on this path
    // and let a token-less POST full of a child's prose compose and dispatch
    // un-gated. The docblock defended it with "with the picker off, no child
    // content is in circulation at all", and that premise is simply false:
    // content served during a flag-on window persists in staff notes, in earlier
    // runs' `slot_values` (which History and Kit both render), and in open tabs.
    // Slot content with no token is at LEAST as suspect once the switch is off.
    return { ok: false, refusal: { ok: false, reason: "unverified_slot_source" } };
  }

  // Belt AND braces: the picker already scrubbed what it returned, and a client
  // is free to have edited it since. Scrubbing the TEMPLATE too is deliberate —
  // a staff member pasting a child's sentence into the template is the same leak
  // by a different door.
  const template = tokens.length > 0 ? scrubNames(input.template, tokens) : input.template;
  const slotValues: SlotValues = scrubSlotValues(input.slotValues, tokens);
  // ⚠ AND THE NOTE. `note` is 2000 characters of free text written straight to a
  // row the migration header describes as recording internal ids only, and it was
  // the one prose field the scrub skipped EVEN WHEN THE TOKENS WERE AVAILABLE —
  // "Maya's second attempt at the soap panel" is exactly what a staff member
  // types there. Unit 5 closed this class for `source_idea_id`/`source_task_id`
  // with a closed character class; free prose cannot take that treatment, so it
  // takes the scrub instead.
  const note = tokens.length > 0 ? scrubNames(input.note ?? "", tokens) : input.note ?? "";

  const decision = decideRunComposition({
    template,
    slotValues,
    modelIds: input.modelIds,
    imageCount: input.imageCount,
    referenceIds: input.referenceIds,
    // ⚠ FROM THE VERIFIED TOKEN, never from a client claim. The composer passes
    // "the picker minted a token" to get an honest preview; this passes "the
    // server verified one", which is the fact the prompt choice hangs off.
    childProvenance: source !== null,
    // ⚠ AND THE ATTESTATION, WHICH IS WHAT AN UNPROVENANCED COMPOSE HANGS OFF.
    // Absent ⇒ false ⇒ every OpenAI cell is composed derived. A client that has
    // never heard of this field therefore gets the safe composition, which is the
    // whole design: the lazy path must be the safe one.
    noChildContentAttested: attested,
    // ⚠ THE SERVER'S READ OF THE FLAG, not a client claim — there is no wire
    // field for it and there must not be one. The composer passes the same value
    // to its own `decideRunComposition` because the bench page read it
    // server-side and handed it down, which is what keeps the preview honest.
    //
    // ⚠ ONLY THE TEXT FLAG APPEARS HERE, AND ITS SIBLING'S ABSENCE IS CORRECT.
    // Composition decides which STRING each cell carries; reference images are
    // not composed, they are loaded at dispatch. `IMAGE_LAB_OPENAI_OPEN_REFERENCES`
    // therefore has nothing to say to this call and is read in `generateCell`.
    openVocabulary: deps.isOpenVocabulary(),
    promptModes: input.promptModes,
  });
  if (!decision.ok) return { ok: false, refusal: decision };

  const runId = deps.newId();
  const run: RunRow = {
    id: runId,
    staffId: input.staffId,
    idempotencyKey: input.idempotencyKey,
    template,
    slotValues,
    resolvedPrompt: decision.resolved.text,
    referenceIds: input.referenceIds ?? [],
    drillTags: input.drillTags ?? [],
    note,
    compare: decision.compare,
    // ⚠ A REGISTRY MODEL ID OR NOTHING. This was 120 free characters landing on
    // the same row as the note — a second prose column wearing an id's name, on a
    // table documented as holding internal ids only. `findModelEntry` is the same
    // closed set every other model decision reads, so an unrecognized value is
    // dropped rather than recorded (the field is a cross-reference for History,
    // and a cross-reference to nothing is worth less than a null).
    iteratedOnModel:
      typeof input.iteratedOnModel === "string" && findModelEntry(input.iteratedOnModel)
        ? input.iteratedOnModel
        : null,
    iteratedFromRunId: input.iteratedFromRunId ?? null,
    // ⚠ FROM THE VERIFIED TOKEN, never off the input. This is the field
    // `usedDbContent` on the audit line is derived from, and the field the
    // consent-revocation purge keys on.
    sourceChildId: source?.childId ?? null,
    sourceIdeaId: source?.ideaId ?? null,
    sourceTaskId: source?.taskId ?? null,
    noChildContentAttested: attested,
    createdAtMs: deps.now(),
    cellCount: decision.cells.length,
  };

  let inserted: Awaited<ReturnType<RunDeps["insertRun"]>>;
  try {
    inserted = await deps.insertRun(run);
  } catch (e) {
    console.error(`[image-lab/run] run insert failed: ${errorName(e)}`);
    return { ok: false, reason: "unavailable" };
  }

  if (!inserted.ok) {
    // THE RESUBMIT. The staff member composed twice for one intent; the unique
    // index caught it. Answer with what already exists — minting a second run
    // here is precisely the double spend the key exists to prevent.
    return resolveExistingRun(deps, {
      staffId: input.staffId,
      idempotencyKey: input.idempotencyKey,
      cells: decision.cells,
      composition: {
        template,
        resolvedPrompt: decision.resolved.text,
        referenceIds: input.referenceIds ?? [],
        // ⚠ PART OF THE COMPOSITION, NOT A FLAG BESIDE IT — see the equality
        // check in `resolveExistingRun`.
        noChildContentAttested: attested,
      },
    });
  }

  try {
    const cells = await deps.insertCells(cellRowsFor(deps, inserted.run.id, decision.cells));
    return { ok: true, run: inserted.run, cells, duplicate: false };
  } catch (e) {
    // The run row landed and its cells did not. NOT repaired here — a retry from
    // the client carries the SAME idempotency key, lands on the duplicate arm
    // above, and `resolveExistingRun` completes the missing cells. Doing it here
    // as well would be a second implementation of the same repair.
    console.error(`[image-lab/run] cell insert failed: ${errorName(e)}`);
    return { ok: false, reason: "unavailable" };
  }
}

function cellRowsFor(
  deps: RunDeps,
  runId: string,
  cells: readonly CellSpec[]
): NewCellRow[] {
  return cells.map((cell) => ({
    id: deps.newId(),
    runId,
    modelId: cell.modelId,
    // ⚠ ASSIGNED, NEVER DERIVED FROM created_at. Postgres `now()` is the
    // TRANSACTION timestamp, so every cell in this insert shares it byte-for-byte
    // and ordering by it hands the compare grid's column order to the executor.
    cellOrdinal: cell.cellOrdinal,
    // ⚠ THE PROMPT IS PERSISTED PER CELL, WITH THE ROW, BEFORE ANYTHING IS SENT.
    // Same discipline as the row itself (intent stamped before the effect): a
    // crash mid-generation leaves a row that says what was going to be sent.
    promptText: cell.promptText,
    promptDerived: cell.promptDerived,
  }));
}

/**
 * Re-run the scrub over every slot value, dropping nothing and adding nothing.
 *
 * Only the four known slots are walked — the same allowlist `run-actions`
 * applies — so a key nobody audited cannot ride in and reach the resolved
 * prompt through this function either.
 */
function scrubSlotValues(values: SlotValues, tokens: readonly string[]): SlotValues {
  const out: SlotValues = {};
  for (const slot of IMAGE_LAB_SLOTS) {
    const value = values?.[slot];
    if (typeof value !== "string") continue;
    out[slot] = tokens.length > 0 ? scrubNames(value, tokens) : value;
  }
  return out;
}

/**
 * The duplicate arm: return the run that already exists, completing its cells if
 * the first attempt died between the two inserts.
 *
 * ⚠ THE REPAIR IS REFUSED WHEN THE COMPOSITIONS DO NOT MATCH. The interrupted-
 * insert branch inserted the INCOMING request's cells against a run whose
 * template, prompt and references are the FIRST request's — so the vendor would
 * be billed for template T1 while the composer showed T2, with the grid, the
 * history row and the evidence all naming T1. A key collision between two
 * genuinely different composes is a client bug, and the honest answer is to say
 * so rather than to answer with somebody else's prompt.
 */
async function resolveExistingRun(
  deps: RunDeps,
  input: {
    staffId: string;
    idempotencyKey: string;
    cells: readonly CellSpec[];
    composition: {
      template: string;
      resolvedPrompt: string;
      referenceIds: readonly string[];
      /** See the equality check below — the attestation is composition, not
       *  metadata about it. */
      noChildContentAttested: boolean;
    };
  }
): Promise<CreateRunResult> {
  const { staffId, idempotencyKey, cells } = input;
  let existing: RunRow | null;
  try {
    existing = await deps.findRunByIdempotency(staffId, idempotencyKey);
  } catch (e) {
    console.error(`[image-lab/run] idempotency re-read failed: ${errorName(e)}`);
    return { ok: false, reason: "unavailable" };
  }
  // A unique violation with no row behind it means the index and the table
  // disagree. Reporting success would hand the composer a run that does not
  // exist and a grid that can never fill.
  if (!existing) return { ok: false, reason: "unavailable" };

  // The stored run is the authority on what this key bought.
  //
  // ⚠ THE ATTESTATION IS PART OF THE COMPOSITION, and leaving it out was the
  // one way this repair could still mint a MISMATCHED ROW. Template, prompt and
  // references can all match across two composes that DISAGREE about whether the
  // text was vouched for — and when they do, the repair inserts the incoming
  // (attested ⇒ possibly AUTHORED) cells against the stored (UNATTESTED) run.
  // The result is an authored OpenAI cell on a run whose row says "not
  // attested", which only the dispatch-side gate then catches. Two composes that
  // disagree about the attestation are not the same composition; treating them
  // as identical is exactly the confusion that produces that row.
  //
  // The real composer cannot reach here — `noChildContentAttested` is already in
  // `compositionSignature`, so a changed attestation mints a new idempotency key
  // — which means the only caller that CAN is a hand-rolled POST reusing a key.
  // That is precisely the threat model the gate exists for, so the honest answer
  // is `idempotency_conflict` rather than somebody else's composition.
  if (
    existing.template !== input.composition.template ||
    existing.resolvedPrompt !== input.composition.resolvedPrompt ||
    existing.noChildContentAttested !== input.composition.noChildContentAttested ||
    existing.referenceIds.length !== input.composition.referenceIds.length ||
    existing.referenceIds.some((id, i) => id !== input.composition.referenceIds[i])
  ) {
    return { ok: false, refusal: { ok: false, reason: "idempotency_conflict" } };
  }

  let existingCells: CellRow[];
  try {
    existingCells = await deps.listCells(existing.id);
  } catch (e) {
    console.error(`[image-lab/run] cell re-read failed: ${errorName(e)}`);
    return { ok: false, reason: "unavailable" };
  }

  if (existingCells.length === 0) {
    // The interrupted-between-inserts repair. Safe precisely BECAUSE it is
    // conditional on zero: a run that already has cells is never topped up, so a
    // resubmit can never double a run's cell count (and therefore its bill).
    try {
      existingCells = await deps.insertCells(cellRowsFor(deps, existing.id, cells));
    } catch (e) {
      console.error(`[image-lab/run] cell repair failed: ${errorName(e)}`);
      return { ok: false, reason: "unavailable" };
    }
  }

  return { ok: true, run: existing, cells: existingCells, duplicate: true };
}

// ── 2. Generate one cell (the paid path) ─────────────────────────────────────

export type GenerateCellInput = {
  staffId: string;
  imageId: string;
  /** The caller's cancellation — the route's residual budget. Passed THROUGH to
   *  the adapter, which composes it with the model's own timeout. */
  abortSignal?: AbortSignal;
};

/**
 * Take one requested cell all the way to a finalized row.
 *
 * ORDER (the caller has already done staff gate → cooldown):
 *   pre-read → CAS → adapter → validate + store → finalize → audit
 *
 * Every arm finalizes or explains itself. Nothing throws across the run boundary:
 * one model's failure never blanks a run (origin R3), and the adapter's contract
 * is that no vendor exception escapes it.
 */
export async function generateCell(
  deps: RunDeps,
  input: GenerateCellInput
): Promise<GenerateCellOutcome> {
  let cell: CellRow | null;
  try {
    cell = await deps.loadCell(input.imageId);
  } catch (e) {
    console.error(`[image-lab/run] cell read failed: ${errorName(e)}`);
    return { kind: "unavailable" };
  }
  if (!cell) return { kind: "not_found" };

  // A finalized cell is a NO-OP, not an error and not a re-dial. Retry appends a
  // new row; it never re-runs a row that already has an answer.
  if (cell.state !== "requested") {
    return { kind: "already_finalized", state: cell.state };
  }

  // ── An ALREADY-ATTEMPTED row can never be re-claimed. Answer here, before the
  //    CAS, and answer TRUTHFULLY in both directions. ────────────────────────
  const nowMs = deps.now();
  if (cell.attemptedAtMs !== null) {
    // ⚠ THE STALE ARM USED TO FALL THROUGH TO THE CAS and come back
    // `not_admitted` — "another request is already generating this cell, wait
    // for it to finish" — which after ten minutes is both untrue and the one
    // instruction that cannot help. `attempted_at` latches the row forever; the
    // only re-entry is a NEW row.
    if (canRetryCell(cell, nowMs)) return { kind: "stale_latched" };
    return {
      kind: "retry_refused",
      retryAfterMs: Math.max(
        1,
        cell.attemptedAtMs + IMAGE_LAB_STALE_AFTER_MS - nowMs
      ),
    };
  }

  let run: RunRow | null;
  try {
    run = await deps.loadRun(cell.runId);
  } catch (e) {
    console.error(`[image-lab/run] run read failed: ${errorName(e)}`);
    return { kind: "unavailable" };
  }
  if (!run) return { kind: "not_found" };
  // ⚠ A RUN BELONGS TO THE STAFF MEMBER WHO COMPOSED IT. Without this, any staff
  // session could drive spend on — and retry — a colleague's run by id, and the
  // audit line would name the caller while the run names someone else.
  // `not_found` rather than a distinct refusal: there is nothing useful a caller
  // learns from being told the id exists.
  if (run.staffId !== input.staffId) {
    // ⚠ REFUSED *AND LOGGED*. The refusal was silent: one staff session driving
    // spend on another's run by id produced no line anywhere, because the
    // generation breadcrumb is emitted post-CAS only and this branch is
    // pre-CAS. Two staff ids and an image id — no run content, no prompt.
    console.warn(
      `[image-lab/run] cross-staff cell refused: caller=${input.staffId} owner=${run.staffId} image=${input.imageId}`
    );
    return { kind: "not_found" };
  }

  // ── THE DISPATCH GATE. The one rule no staff choice can override. ─────────
  //
  // ⚠ IT RUNS HERE — SERVER-SIDE, ON THE PAID PATH, ON THE EXACT STRING ABOUT TO
  // BE SENT — and every word of that is load-bearing:
  //
  //   * SERVER-SIDE, not in the composer. The composer's per-model selector is a
  //     convenience; the threat is a crafted or replayed POST to this route, and
  //     a client-side check is advisory against exactly that.
  //   * ON THE RESOLVED STRING, not on `run.template` and not on the run's
  //     default prompt. A template of pure `{{slot}}` tokens looks innocent and
  //     resolves to the child's whole pitch; a template a staff member pasted the
  //     derived wording into would clear a template-level check while this row
  //     carried something else entirely.
  //   * AND IT REFUSES RATHER THAN SUBSTITUTING. Swapping the derived prompt in
  //     silently would leave a row whose `resolved_prompt` is not what the vendor
  //     received — and every keep/reject judged on that image would be attributed
  //     to a prompt that never ran. A refused cell is recoverable; corrupted
  //     evidence is not.
  //
  // BEFORE THE CAS, so a refusal leaves the cell untouched and re-generatable
  // once the prompt choice is fixed, with nothing dialled and nothing billed.
  // ⚠ NO `?? run.resolvedPrompt` FALLBACK. It existed for "rows written before
  // per-cell prompts existed" — a population that does not exist and never will
  // (the table was empty when the column landed), so what it actually did was
  // cover a null with THE RUN'S AUTHORED RESOLUTION: the child's own words,
  // substituted for a cell that had been deliberately composed derived. A row
  // that cannot say what it will send must not send anything.
  const dispatchPrompt = cell.resolvedPrompt;
  if (dispatchPrompt.trim() === "") {
    console.warn(
      `[image-lab/run] cell has no recorded prompt: caller=${input.staffId} image=${input.imageId}`
    );
    return { kind: "prompt_missing" };
  }

  const gate = decideChildTextGate({
    modelId: cell.modelId,
    // From the ROW, which `createRun` derived from a verified token. Not from the
    // request, which states nothing about provenance at all.
    childProvenance: run.sourceChildId !== null,
    // Also from the ROW. A run composed by a client that never sent the field has
    // `false` here, which is the constrained answer.
    noChildContentAttested: run.noChildContentAttested,
    promptText: dispatchPrompt,
    // ⚠ THE REFERENCES ARE PART OF THE DISPATCH. Loaded below, but their PRESENCE
    // is known from the run row now — the gate must not be asked to bless a call
    // whose second payload it never saw.
    hasReferences: run.referenceIds.length > 0,
    // ⚠ BOTH READ AT DISPATCH, NOT AT COMPOSE, AND THAT IS THE POINT OF READING
    // THEM HERE. The gate is the enforcement; it must answer with the
    // deployment's CURRENT posture. A run composed while a flag was on and
    // retried after an operator unset it is refused on the retry — which is what
    // "reversing the decision is unsetting the env var, no deploy needed"
    // actually means. And because they are read independently, unsetting one
    // leaves the other's channel exactly where it was.
    openVocabulary: deps.isOpenVocabulary(),
    openReferences: deps.isOpenReferences(),
  });
  if (!gate.ok) {
    // Ids and the closed-set reason only — no prompt, no slot value, no child id.
    console.warn(
      `[image-lab/run] child-text gate refused: caller=${input.staffId} ` +
        `image=${input.imageId} model=${cell.modelId} reason=${gate.reason}`
    );
    switch (gate.reason) {
      case "child_reference_to_openai":
        return { kind: "child_reference_gate" };
      case "unknown_model":
        return { kind: "unknown_model_gate" };
      case "child_text_to_openai":
        return { kind: "child_text_gate" };
    }
  }

  // ── REFERENCES BEFORE THE CAS, and that ordering is two fixes at once ─────
  //   * a storage fault no longer CONSUMES the cell. The old order claimed the
  //     row, failed the read, and filed the result as a vendor `provider_error`
  //     — contaminating the per-model failure evidence Unit 6 breaks out
  //     precisely to keep infra artifacts out of the model comparison.
  //   * the download no longer sits inside the post-CAS window, where a slow
  //     one could push the invocation past the platform ceiling with the vendor
  //     billed, no put, no finalize, no audit and the row latched.
  let references: { bytes: Uint8Array; contentType: ImageLabMimeType }[] = [];
  if (run.referenceIds.length > 0) {
    try {
      references = await deps.loadReferenceBytes(run.referenceIds);
    } catch (e) {
      // A reference we cannot read would silently change the drill: the cell
      // would generate without the hero sheet and be scored as if it had one.
      console.error(`[image-lab/run] reference read failed: ${errorName(e)}`);
      return { kind: "reference_unavailable" };
    }
  }

  // ── THE CAS. Nothing below this line may run without it. ──────────────────
  let claimed: CellRow | null;
  try {
    claimed = await deps.markAttempt(input.imageId);
  } catch (e) {
    console.error(`[image-lab/run] mark-attempt failed: ${errorName(e)}`);
    return { kind: "unavailable" };
  }
  if (claimed === null) {
    // ZERO ROWS BACK ⇒ DO NOT CALL THE VENDOR. Another request holds this cell.
    // This is the branch that makes two tabs cost one image.
    return { kind: "not_admitted" };
  }

  /**
   * ⚠ EXACTLY ONE AUDIT LINE PER CLAIMED CELL, EMITTED FROM A `finally`.
   *
   * Money has now been authorized, and three terminal paths used to leave no
   * trace of it at all: a `finalize` THROW after a successful paid generation
   * (object, cost record and audit line all lost), `finalizeFailure`'s own
   * finalize throw, and the storage-put arm where `forceBilled` spend vanished
   * entirely. The breadcrumb is the operational record of the spend, so it must
   * not be conditional on the DB write that follows it succeeding — a `finally`
   * is what makes that true for a throw as well as for a return.
   */
  const trace = { outcome: "unavailable", billed: false };
  const claimedCell = claimed;
  const loadedRun = run;
  try {
    // ⚠ THE ONE POST-CAS AWAIT THAT HAD NO GUARD. The adapter's contract is that
    // no vendor exception escapes it — but the run-loader wrapper, `AbortSignal`
    // composition, reference marshalling and an OOM are all outside that
    // contract, and a throw here latched the row for the full staleness window
    // with no finalize and no audit.
    const abortedBeforeDispatch = input.abortSignal?.aborted === true;
    let result: NormalizedImageResult;
    try {
      result = await deps.generate({
        modelId: claimedCell.modelId,
        // ⚠ THE CELL'S OWN PROMPT — the exact string the gate above just cleared
        // and the exact string the row reports. The run-level fallback covers
        // rows written before per-cell prompts existed and nothing else.
        prompt: dispatchPrompt,
        referenceImages: references,
        abortSignal: input.abortSignal,
      });
    } catch (e) {
      // ⚠ THE ERROR'S *NAME*, NEVER THE ERROR OBJECT. This used to be
      // `console.error("…:", e)`, and `e` here is the ONE error in this feature
      // this repo did not mint: the AI SDK's `AI_APICallError` carries
      // `requestBodyValues` — THE PROMPT — as an own enumerable property, and
      // `console.error` inspects the whole object. That put a resolved prompt,
      // its slot values and any child-authored text inside them into the
      // operator log, contradicting the discipline `image-model.ts` states
      // explicitly (it logs a closed-set code and never a vendor message).
      // ⚠ AND A BARE NAME IS NOT ENOUGH EITHER. The realistic faults on this
      // await are a `TypeError` ("fetch failed", real cause on `e.cause`) and a
      // plain `Error` — so a name-only line degrades to the literal string
      // "Error" and tells an operator nothing. {@link errorName} pairs the name
      // with a closed-set classification and the cause's `code`, which is the
      // field that actually triages. The structured `failure_reason` on the row
      // remains the real diagnostic.
      console.error(
        `[image-lab/run] adapter threw across the run boundary: ${errorName(e)}`
      );
      result = { kind: "provider_error", detail: "unknown_error" };
    }

    if (result.kind !== "generated") {
      // ⚠ A `caller_aborted` AFTER DISPATCH IS BILLED-UNKNOWN, NOT NOT-BILLED.
      // An abort at t=200s has almost certainly billed; recording it unbilled
      // AND `failed` made it immediately retryable, which is a designed second
      // payment. Only an abort that arrived BEFORE we dialled is genuinely free.
      const abortedAfterDispatch =
        result.kind === "timeout" &&
        result.cause === "caller_aborted" &&
        !abortedBeforeDispatch;
      return await finalizeFailure(deps, {
        run: loadedRun,
        cell: claimedCell,
        result,
        staffId: input.staffId,
        forceBilled: abortedAfterDispatch,
        trace,
      });
    }

    const storageKey = runObjectKey(loadedRun.id, claimedCell.id);
    try {
      // ⚠⚠ `result.bytes` GOES IN DIRECTLY. Never `result.bytes.buffer`, never
      // `new Uint8Array(result.bytes.buffer)`. The SDK's `uint8Array` may be a
      // VIEW over a larger pooled ArrayBuffer, so uploading the backing buffer
      // would upload adjacent heap memory from the same serverless invocation —
      // other requests' bytes — into a bucket that is then served to a browser
      // by signed URL. `__tests__/run-core.test.ts` round-trips an offset view's
      // exact byte length for exactly this mutation.
      //
      // The content type is the SNIFFED one from NormalizedImageResult (Unit 2),
      // never a vendor-declared header: these objects are served on the storage
      // origin, where a mislabelled document is an executable one.
      await deps.putObject(storageKey, result.bytes, result.contentType);
    } catch (e) {
      console.error(`[image-lab/run] storage put failed: ${errorName(e)}`);
      return await finalizeFailure(deps, {
        run: loadedRun,
        cell: claimedCell,
        // Billed: the vendor generated and charged; we lost the bytes afterwards.
        result: { kind: "provider_error", detail: "unknown_error" },
        staffId: input.staffId,
        forceBilled: true,
        trace,
      });
    }

    const entry = findModelEntry(claimedCell.modelId);
    const patch: FinalizePatch = {
      imageId: claimedCell.id,
      state: "done",
      storageKey,
      contentType: result.contentType,
      failureReason: null,
      failureDetail: null,
      billed: true,
      costEstimatedUsd: entry ? estimatedCostUsd(entry, null) : null,
      costReportedUsd: result.costReportedUsd,
      gatewayGenerationId: result.gatewayGenerationId,
    };

    // Recorded BEFORE the write, so a throw inside it still leaves the trace.
    trace.outcome = "done";
    trace.billed = true;

    let written: { rowsMatched: number };
    try {
      written = await deps.finalize(patch);
    } catch (e) {
      // ⚠ THE PAID GENERATION IS ALREADY IN THE BUCKET AND NOTHING WILL EVER
      // NAME IT — the row still says `requested`, so no reader resolves this
      // key. Same reasoning as the purge branch below: the key is deterministic,
      // so the object is provably this call's own. Remove it rather than
      // orphaning it, and let the `finally` write the breadcrumb.
      //
      // ⚠⚠ BUT "REPORTED FAILED" IS NOT "DID NOT LAND", AND DELETING ON THAT
      // ASSUMPTION DESTROYS A LIVE IMAGE. `bounded()` in run-loader says so in
      // its own docblock: it races a 5s wall against the query and giving up on
      // the WAIT does not cancel the request. So the sequence that matters is —
      // the wall elapses, we land here, and Postgres then COMMITS
      // `state='done', storage_key=…, billed=true`. Removing the object there
      // leaves a `done` row pointing at nothing: Unit 6 counts it as a
      // completion, a reviewer can Keep it, `listKeptImages` serves it into the
      // Kit as a harvestable result with no bytes behind it, and the cost is
      // counted for an image that does not exist.
      //
      // A timed-out write is UNKNOWN, not failed. So we RE-READ and remove only
      // if the row is still `requested` — the one state in which nothing will
      // ever name this object. A re-read that itself fails leaves the object,
      // which is the safe direction: an orphan is recoverable (the key is
      // deterministic and names itself), a deleted live image is not.
      console.error(`[image-lab/run] finalize failed: ${errorName(e)}`);
      trace.outcome = "finalize_failed";
      let stillUnclaimed = false;
      try {
        const reread = await deps.loadCell(claimedCell.id);
        stillUnclaimed = reread !== null && reread.state === "requested";
      } catch (rereadError) {
        console.error(
          `[image-lab/run] post-finalize re-read failed for ${storageKey}: ${errorName(rereadError)}`
        );
      }
      if (stillUnclaimed) {
        try {
          await deps.removeObject(storageKey);
        } catch (removeError) {
          console.error(
            `[image-lab/run] orphan cleanup failed for ${storageKey}: ${errorName(removeError)}`
          );
        }
      } else {
        trace.outcome = "finalize_unknown";
      }
      return { kind: "unavailable" };
    }

    if (written.rowsMatched === 0) {
      // ⚠ THE RUN WAS PURGED UNDERNEATH US (the migration header's consent-
      // revocation runbook explicitly requires this branch). The row is gone, so
      // nothing will ever name the object we just wrote — and because the key is
      // deterministic, it is exactly the object this call created and cannot be
      // anyone else's. Delete it rather than orphaning it.
      trace.outcome = "run_purged";
      try {
        await deps.removeObject(storageKey);
      } catch (e) {
        console.error(`[image-lab/run] orphan cleanup failed for ${storageKey}: ${errorName(e)}`);
      }
      return { kind: "run_purged" };
    }

    return { kind: "done", imageId: claimedCell.id };
  } finally {
    audit(deps, {
      run: loadedRun,
      cell: claimedCell,
      staffId: input.staffId,
      outcome: trace.outcome,
      billed: trace.billed,
    });
  }
}

/**
 * Finalize a cell that did not produce a usable image.
 *
 * ⚠ NOTHING IS IN THE BUCKET ON THIS PATH. Every arm that reaches here either
 * never called the vendor, or called it and got no storable bytes — a payload
 * that failed the magic-byte sniff is rejected INSIDE the adapter and arrives
 * here as `provider_error`, so the storage put never ran.
 */
async function finalizeFailure(
  deps: RunDeps,
  input: {
    run: RunRow;
    cell: CellRow;
    result: NormalizedImageResult;
    staffId: string;
    forceBilled?: boolean;
    /** The caller's audit record, set BEFORE the DB write. See `generateCell`. */
    trace: { outcome: string; billed: boolean };
  }
): Promise<GenerateCellOutcome> {
  const reason = failureReasonForResult(input.result);
  // `generated` cannot reach here (the caller branches on it first); the guard
  // keeps that a compiler-visible fact rather than a comment.
  //
  // ⚠ THE TRACE IS STAMPED BEFORE THE EARLY RETURN. The `finally` in
  // `generateCell` still fires on this path and would otherwise emit the DEFAULT
  // trace — `outcome=unavailable billed=false` — on a cell whose CAS has already
  // been claimed and whose vendor call may well have been paid for. An audit line
  // that says "not billed" about a billed call is worse than no audit line.
  if (reason === null) {
    input.trace.outcome = "unexpected_generated";
    input.trace.billed = input.forceBilled === true || isBilledOutcome(input.result);
    return { kind: "unavailable" };
  }

  // ⚠ ONE definition of "did this cost money", imported from Unit 2's pure rules.
  // A second copy here is the one duplicate this feature cannot afford: an
  // adapter_timeout IS billed (vendors bill on generation, not delivery) and a
  // caller_aborted is not, and getting that backwards biases the model decision
  // the whole Lab exists to make.
  const billed = input.forceBilled === true || isBilledOutcome(input.result);
  const entry = findModelEntry(input.cell.modelId);
  const detail =
    input.result.kind === "provider_error"
      ? input.result.detail
      : input.result.kind === "timeout"
        ? input.result.cause
        : input.result.kind === "safety_blocked"
          ? input.result.reason
          : null;

  // ⚠ RECORDED BEFORE THE WRITE. A finalize that throws here — including the
  // `forceBilled` storage-put arm, where real spend would otherwise leave zero
  // trace anywhere — still leaves exactly one breadcrumb, emitted by the
  // caller's `finally`.
  input.trace.outcome = reason;
  input.trace.billed = billed;

  let written = { rowsMatched: 0 };
  try {
    written = await deps.finalize({
      imageId: input.cell.id,
      state: "failed",
      storageKey: null,
      contentType: null,
      failureReason: reason,
      failureDetail: detail,
      billed,
      // Cost ONLY where billed — `fp_image_lab_images_cost_needs_billed`. A
      // billed-but-failed timeout DOES carry a cost, which is the case the
      // per-model economics need and the constraint deliberately allows.
      costEstimatedUsd: billed && entry ? estimatedCostUsd(entry, null) : null,
      costReportedUsd: null,
      gatewayGenerationId: null,
    });
  } catch (e) {
    console.error(`[image-lab/run] failure finalize failed: ${errorName(e)}`);
    return { kind: "unavailable" };
  }

  if (written.rowsMatched === 0) {
    input.trace.outcome = "run_purged";
    return { kind: "run_purged" };
  }
  return { kind: "failed", imageId: input.cell.id, reason, detail };
}

/** ONE breadcrumb per generation call, built by the pure formatter whose TYPE has
 *  no field a prompt, a slot value or a child field could travel in. */
function audit(
  deps: RunDeps,
  input: {
    run: RunRow;
    cell: CellRow;
    staffId: string;
    outcome: string;
    billed: boolean;
  }
): void {
  deps.audit(
    formatGenerationBreadcrumb({
      staffId: input.staffId,
      atIso: new Date(deps.now()).toISOString(),
      modelId: input.cell.modelId,
      cellCount: input.run.cellCount,
      // ⚠ A BOOLEAN, NEVER THE CONTENT. A consent audit needs to know that a run
      // was built from a real child's authored text; it does not need — and must
      // never be handed — the text itself, or the child's id in a log line.
      usedDbContent: input.run.sourceChildId !== null,
      outcome: input.outcome,
      billed: input.billed,
    })
  );
}

// ── 3. Retry (append a new row; never re-run an old one) ─────────────────────

export type RetryResult =
  | { ok: true; imageId: string }
  | { ok: false; outcome: GenerateCellOutcome };

/**
 * Retry one cell by APPENDING a new attempt at the same grid position.
 *
 * ⚠ RETRY-AS-NEW-ROW IS THE ONLY RE-ENTRY PATH. A row that has been attempted is
 * latched forever: its `attempted_at` is set, so its CAS can never admit a second
 * call, and mutating it would destroy the per-attempt cost history the model
 * comparison is built on. The new row carries the SAME `(run_id, model_id,
 * cell_ordinal)`, which is what lets the grid stack the attempts in one cell.
 *
 * ⚠ REFUSED UNTIL STALENESS for a non-finalized cell. A pending cell has a vendor
 * call running; appending a second attempt pays twice for one intent, and the new
 * row's own CAS is no help because it is a different row.
 */
export async function retryCell(
  deps: RunDeps,
  input: { imageId: string; staffId: string }
): Promise<RetryResult> {
  let cell: CellRow | null;
  try {
    cell = await deps.loadCell(input.imageId);
  } catch (e) {
    console.error(`[image-lab/run] retry read failed: ${errorName(e)}`);
    return { ok: false, outcome: { kind: "unavailable" } };
  }
  if (!cell) return { ok: false, outcome: { kind: "not_found" } };

  // Same ownership rule as the paid path: minting a row is minting a spend.
  let run: RunRow | null;
  try {
    run = await deps.loadRun(cell.runId);
  } catch (e) {
    console.error(`[image-lab/run] retry run read failed: ${errorName(e)}`);
    return { ok: false, outcome: { kind: "unavailable" } };
  }
  // ⚠ REFUSED *AND LOGGED*, AND THE TWO CAUSES ARE DISTINGUISHED. The README
  // claimed that generate AND retry both log the cross-staff refusal; only
  // `generateCell` did. Retry is the path that MINTS A NEW BILLABLE ROW, so if
  // either of the two had to be the silent one it was the wrong choice — and the
  // two causes need telling apart, because "the run vanished" is a data fault
  // worth chasing and "someone else's run" is a refusal worth counting.
  // Ids only: no run content, no prompt.
  if (!run) {
    console.warn(
      `[image-lab/run] retry refused, no run: caller=${input.staffId} run=${cell.runId} image=${input.imageId}`
    );
    return { ok: false, outcome: { kind: "not_found" } };
  }
  if (run.staffId !== input.staffId) {
    console.warn(
      `[image-lab/run] cross-staff retry refused: caller=${input.staffId} owner=${run.staffId} image=${input.imageId}`
    );
    return { ok: false, outcome: { kind: "not_found" } };
  }

  // ⚠ A NEVER-ATTEMPTED ROW IS NOT A RETRY. Staleness ages such a row from
  // `created_at` (correctly), so the UI offered Retry on a cell nothing had ever
  // touched — appending a SECOND live `requested` row for one intended image,
  // both of them generatable and both billable. The correct action there is
  // generateCell, on the row that already exists.
  if (cell.state === "requested" && cell.attemptedAtMs === null) {
    return { ok: false, outcome: { kind: "not_attempted" } };
  }

  const nowMs = deps.now();
  if (!canRetryCell(cell, nowMs)) {
    const since = cell.attemptedAtMs ?? cell.createdAtMs;
    return {
      ok: false,
      outcome: {
        kind: "retry_refused",
        retryAfterMs: Math.max(1, since + IMAGE_LAB_STALE_AFTER_MS - nowMs),
      },
    };
  }

  try {
    const [appended] = await deps.insertCells([
      {
        id: deps.newId(),
        runId: cell.runId,
        modelId: cell.modelId,
        cellOrdinal: cell.cellOrdinal,
        // ⚠ THE ATTEMPT'S OWN PROMPT, CARRIED FORWARD VERBATIM. A retry is
        // another attempt at the SAME experiment; re-deriving it here — or
        // falling back to the run default, which is the AUTHORED resolution and
        // would turn a derived cell's retry into the child's own words — would
        // silently make the two attempts incomparable and unsafe at once.
        promptText: cell.resolvedPrompt,
        promptDerived: cell.promptDerived,
      },
    ]);
    if (!appended) return { ok: false, outcome: { kind: "unavailable" } };
    return { ok: true, imageId: appended.id };
  } catch (e) {
    console.error(`[image-lab/run] retry insert failed: ${errorName(e)}`);
    return { ok: false, outcome: { kind: "unavailable" } };
  }
}
