import "server-only";

/**
 * The cover-generation SEQUENCING core (New User Flow v3, Unit 4).
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable. The thin wire is ./route.ts; every decision it makes is in
 * the pure ./cover-rules.ts.
 *
 * ── AUTHORIZATION IS PHASE ONE, AND IT IS A SEPARATE FUNCTION ──
 * `authorizeCoverGeneration` runs EVERY gate and performs NO generation. Only
 * once it returns `{ ok: true }` does the route open the SSE stream and call
 * `performCoverGeneration`. The split is the point: it makes "a refusal never
 * reaches the work" a property of the SHAPE of this module rather than of the
 * order of statements inside one long function, and it lets the route answer a
 * refusal with a real HTTP status instead of a 200 stream carrying bad news
 * (headers are already committed once a stream opens).
 *
 * THE ORDER INSIDE PHASE ONE, and why each step is where it is:
 *
 *   1. AUTHENTICATE THE CALLER. Not the draft id — a draft id is an
 *      identifier, never a credential. (Unit 2's IDOR and Unit 3's review are
 *      both this same lesson: the thing the client names is not the thing that
 *      authorizes them to name it.)
 *   2. REFUSE THE KID-BEARER PATH. Plan Unit 7's FP add-photo hook will present
 *      a child's Supabase Bearer token here. That path is NOT built in this
 *      unit, so it is a GUARDED SEAM THAT REFUSES — never an unchecked
 *      fall-through into the parent branch, which is how a token-shaped caller
 *      would otherwise be handled by code written for a cookie-shaped one.
 *      ⚠ RECOGNITION IS ALSO UNBUILT: nothing in this build ever CONSTRUCTS a
 *      `kid_bearer` caller (route.ts's `authenticate` is cookie-only and does
 *      not read the Authorization header), so this branch is dead code today.
 *      It is a typed placeholder for the shape Unit 7 must produce, not a live
 *      detection. Unit 7 owns BOTH halves: teaching `authenticate` to see a
 *      Bearer credential, and then replacing this refusal with the real check.
 *   3. PARSE. After authentication, so a malformed body from a stranger costs
 *      us no parsing at all.
 *   4. REFUSE A PHOTO IN TEMPLATE MODE. Before the privileged client exists and
 *      before a single byte of it is examined: with no vendor to send a minor's
 *      photo to and no store to put it in, the honest behaviour is to not
 *      collect it.
 *   5. REFUSE A MODE PHASE TWO CANNOT PERFORM. See `decideGenerationFeasible`.
 *      This is deliberately here, above every write, because a doomed request
 *      must never spend a durable resource on its way to failing.
 *   6. BUILD THE PRIVILEGED CLIENT AND RESOLVE OWNERSHIP. `deps.db` is a
 *      FACTORY, not a client, precisely so this is observable: nothing above
 *      this line can have touched the service-role key. The draft is read with
 *      `parent_id` in the WHERE clause, so a foreign draft does not return a row
 *      to check — it returns nothing.
 *   7. CONSENT. `photoConsentVerdict` at >= FP_PHOTO_CONSENT_MIN_VERSION,
 *      honouring the per-child tombstone.
 *   8. CAP. A fast refusal on the value we just read; the DURABLE enforcement is
 *      the compare-and-set in phase two.
 *
 * ── WHY THE CONSENT GATE RUNS ON THE NO-PHOTO PATH TOO (judgment call) ──
 * The photo path is closed in this unit, so a gate that only guarded photos
 * would guard nothing and be unexercised until the day it matters. It also
 * would not be right: policy 2026-08-05.1 consents to storing "the generated
 * cover picture on my child's profile", which is what this endpoint does
 * whether or not a photo was involved. So the gate runs on every generation.
 *
 * WHO ACTUALLY PAYS FOR THAT: anyone whose newest consent predates the photo
 * anchor. That is the pre-v3 cohorts (beta families, v2 applicants) AND — the
 * case it is tempting to overlook — a V3 PARENT WHO STARTED A DRAFT BEFORE THE
 * POLICY BUMP: `firstIncompleteV3Step` skips the parent step for an
 * already-verified session, so they resume straight onto the cover step and meet
 * `consent_required` on their very first attempt. The impact is small by
 * construction (the cover is optional and never gates `continue`), and the fix
 * is the same one for everyone: plan Unit 8's dashboard re-consent. A
 * re-consent flow is deliberately NOT added here — this endpoint draws a
 * picture; it is not the place to collect a legal affirmation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FP_PHOTO_CONSENT_MIN_VERSION,
  photoConsentVerdict,
  type PhotoConsentRow,
} from "@/app/api/fp/signup/consent-rules";
import { decideCoverStatusWrite, type CoverStatus } from "@/app/lib/fp/cover-store-rules";
import { renderTemplateCover, type CoverTemplateInput } from "@/app/lib/fp/cover-template";
import {
  COVER_GENERATION_CAP,
  COVER_RESERVE_CAS_RETRIES,
  decideGenerationCap,
  decideGenerationFeasible,
  decidePhotoAdmission,
  isCoverAiLive,
  isPhotoContentType,
  parseCoverRequest,
  resolveCoverMode,
  type CoverMode,
  type CoverRefusalReason,
  type CoverStage,
} from "./cover-rules";

/* ------------------------------------------------------------------ deps */

/** Who is calling. `parent` is the cookie session during onboarding and from
 *  the dashboard; `kid_bearer` is the (currently refused) FP hook. */
export type CoverCaller =
  | { kind: "parent"; parentId: string }
  | { kind: "kid_bearer"; childId: string | null };

export type CoverDeps = {
  /**
   * Resolve the caller from the request's own credentials. Returns null for an
   * unauthenticated caller. Injected so tests can prove the negative — that an
   * unauthenticated request never reaches `db()`.
   */
  authenticate: () => Promise<CoverCaller | null>;
  /**
   * The SERVICE-ROLE client, as a FACTORY. `fp_onboarding_drafts`,
   * `fp_parental_consent` and `children` are RLS-on with zero policies, so
   * there is no session-scoped client that could read them; every query below
   * is scoped by the session-derived parent id explicitly, which is the access
   * control the missing policies would be.
   *
   * A factory rather than a value so that "no privileged client is constructed
   * before authorization" is a TESTABLE claim rather than a comment.
   */
  db: () => SupabaseClient;
  now: () => number;
  env: { COVER_AI_LIVE?: string };
  /**
   * ⚠ THE AI VENDOR SEAM — ABSENT IN THIS BUILD, ON PURPOSE.
   *
   * When the gpt-image-2 adapter lands it is injected here, alongside a
   * `BlobPort` for persistence (app/lib/fp/cover-store.ts already defines the
   * port and documents what a real adapter must satisfy). Until then it is
   * `undefined`, `resolveCoverMode` therefore answers `"template"` regardless of
   * `COVER_AI_LIVE`, and no code path can reach a vendor call. It is deliberately
   * NOT stubbed to succeed: a stub that returns a picture would let every
   * downstream status, blob rule and test pass while nothing real happened.
   */
  generateImage?: (input: {
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: string }>;
  /** Injected so a test can prove the compositor was never reached on a refusal.
   *  Defaults to the real, pure template renderer. */
  renderCover?: (input: CoverTemplateInput) => string;
};

/* ------------------------------------------------------------- phase one */

/** What a successful authorization hands to phase two. Everything here was READ
 *  under the caller's own scope; nothing was taken from the request body. */
export type AuthorizedCover = {
  mode: CoverMode;
  parentId: string;
  draftId: string;
  attemptId: string | null;
  childId: string | null;
  firstName: string;
  age: number | null;
  answers: Record<string, string>;
  /** The count this request OBSERVED. Phase two's CAS predicates on exactly it. */
  generationCount: number;
  db: SupabaseClient;
};

export type CoverAuthzResult =
  | { ok: true; authorized: AuthorizedCover }
  | { ok: false; reason: CoverRefusalReason; detail?: string };

type DraftRow = Record<string, unknown>;

const DRAFT_COLUMNS =
  "id, parent_id, signup_attempt_id, child_id, kid_first_name, kid_age, answers, cover_status, cover_blob_key, generation_count, status";

function readAnswers(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

export async function authorizeCoverGeneration(
  deps: CoverDeps,
  input: { body: unknown; photoContentType?: string | null }
): Promise<CoverAuthzResult> {
  // 1 + 2. WHO is calling. Nothing below runs for a caller we cannot name.
  const caller = await deps.authenticate();
  if (!caller) return { ok: false, reason: "unauthenticated" };
  if (caller.kind === "kid_bearer") {
    // The guarded seam. Plan Unit 7 opens this by (a) verifying the Bearer token
    // resolves to a child, (b) proving that child IS the target, (c) adding the
    // cross-origin allowlist + preflight in route.ts. Until all three exist,
    // refusing is the only correct answer — a Bearer caller must never be
    // silently treated as the parent whose draft is being addressed.
    return { ok: false, reason: "kid_path_closed" };
  }

  const mode = resolveCoverMode({
    aiLive: isCoverAiLive(deps.env.COVER_AI_LIVE),
    hasVendorAdapter: typeof deps.generateImage === "function",
  });

  // 3. THE PHOTO DOOR, HEADER FIRST. A multipart / image request is a photo
  //    attempt, and it is refused from the CONTENT TYPE ALONE — before the body
  //    is parsed, and (in route.ts) before it is even read. The order matters:
  //    parsing first would answer a minor's photo upload with `bad_request`,
  //    which tells the family nothing true about why we declined.
  if (isPhotoContentType(input.photoContentType)) {
    const headerAdmission = decidePhotoAdmission({ mode, photoAttempted: true });
    if (!headerAdmission.ok) return { ok: false, reason: headerAdmission.reason };
  }

  // 4. PARSE — after authentication and after the photo door.
  const parsed = parseCoverRequest(input.body);
  if (!parsed.ok) return { ok: false, reason: "bad_request" };

  // The other shape a photo can take: a data URL smuggled in the JSON body.
  const admission = decidePhotoAdmission({ mode, photoAttempted: parsed.data.photoAttempted });
  if (!admission.ok) return { ok: false, reason: admission.reason };

  // 5. FEASIBILITY — refuse a mode phase two cannot perform, and refuse it HERE,
  //    where no privileged client exists and no row has been touched. See
  //    `decideGenerationFeasible`: a doomed request must not reserve.
  const feasible = decideGenerationFeasible(mode);
  if (!feasible.ok) {
    console.error(
      `[fp/cover] mode "${mode}" has no generator in this build — refusing before the reservation`
    );
    return { ok: false, reason: feasible.reason };
  }

  // 6. OWNERSHIP. FIRST construction of the privileged client, and the parent id
  //    goes in the WHERE clause — a draft this parent does not own returns no
  //    row at all, so there is nothing to accidentally proceed with.
  const db = deps.db();
  const found = await db
    .from("fp_onboarding_drafts")
    .select(DRAFT_COLUMNS)
    .eq("id", parsed.data.draftId)
    .eq("parent_id", caller.parentId)
    .maybeSingle();
  if (found.error) {
    console.error(`[fp/cover] draft read failed: ${found.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const draft = found.data as DraftRow | null;
  // `not_found` covers both "no such draft" and "not yours": a caller must not
  // be able to tell which draft ids exist.
  if (!draft || typeof draft.id !== "string") return { ok: false, reason: "not_found" };
  if (draft.status !== "active") return { ok: false, reason: "not_found" };

  const attemptId = typeof draft.signup_attempt_id === "string" ? draft.signup_attempt_id : null;
  const childId = typeof draft.child_id === "string" ? draft.child_id : null;

  // 7. CONSENT — before any generation, on every path (see the module header).
  const consent = await loadPhotoConsent(db, {
    parentId: caller.parentId,
    attemptId,
    childId,
  });
  if (!consent.ok) return { ok: false, reason: "outage" };
  const verdict = photoConsentVerdict({ rows: consent.rows, revokedAt: consent.revokedAt });
  if (!verdict.ok) {
    console.error(
      `[fp/cover] photo consent refused for draft ${draft.id}: ${verdict.reason} (anchor ${FP_PHOTO_CONSENT_MIN_VERSION})`
    );
    return { ok: false, reason: "consent_required", detail: verdict.reason };
  }

  // 8. CAP — the fast refusal. The durable enforcement is phase two's CAS.
  const generationCount =
    typeof draft.generation_count === "number" && Number.isInteger(draft.generation_count)
      ? draft.generation_count
      : 0;
  const cap = decideGenerationCap({ generationCount });
  if (!cap.ok) return { ok: false, reason: cap.reason };

  return {
    ok: true,
    authorized: {
      mode,
      parentId: caller.parentId,
      draftId: draft.id,
      attemptId,
      childId,
      firstName: typeof draft.kid_first_name === "string" ? draft.kid_first_name : "",
      age:
        typeof draft.kid_age === "number" && Number.isInteger(draft.kid_age) ? draft.kid_age : null,
      answers: readAnswers(draft.answers),
      generationCount,
      db,
    },
  };
}

/**
 * The photo/cover consent EXISTS query, in the two shapes a target can take.
 *
 * During onboarding there is NO CHILD YET — the consent recorded at step 2 is
 * bound to the draft's signup ATTEMPT and its `child_id` is still null. So the
 * lookup keys on the attempt. Once the draft has been provisioned (the dashboard
 * / FP re-run paths, plan Units 7-8) the child exists and is the better key, and
 * it is also the only key under which the per-child TOMBSTONE means anything.
 * Both queries are additionally scoped by `parent_id`, which is redundant with
 * the caller's ownership of the draft and cheap insurance if that ever changes.
 */
async function loadPhotoConsent(
  db: SupabaseClient,
  input: { parentId: string; attemptId: string | null; childId: string | null }
): Promise<{ ok: true; rows: PhotoConsentRow[]; revokedAt: string | null } | { ok: false }> {
  const rows: PhotoConsentRow[] = [];
  if (input.attemptId) {
    const res = await db
      .from("fp_parental_consent")
      // `evidence` rides along for the verdict's photo_declined read (fpv03 U3
      // review, FIX A): the decline travels WITH the acceptance row.
      .select("policy_version, accepted_at, revoked_at, evidence")
      .eq("parent_id", input.parentId)
      .eq("signup_attempt_id", input.attemptId);
    if (res.error) {
      console.error(`[fp/cover] consent read (attempt) failed: ${res.error.message}`);
      return { ok: false };
    }
    rows.push(...toConsentRows(res.data));
  }

  let revokedAt: string | null = null;
  if (input.childId) {
    const res = await db
      .from("fp_parental_consent")
      .select("policy_version, accepted_at, revoked_at, evidence")
      .eq("parent_id", input.parentId)
      .eq("child_id", input.childId);
    if (res.error) {
      console.error(`[fp/cover] consent read (child) failed: ${res.error.message}`);
      return { ok: false };
    }
    rows.push(...toConsentRows(res.data));

    const child = await db
      .from("children")
      .select("photo_consent_revoked_at")
      .eq("id", input.childId)
      .maybeSingle();
    if (child.error) {
      // FAIL CLOSED. An unreadable tombstone is not an absent tombstone, and the
      // tombstone is the control that keeps a revocation from being re-opened by
      // a racing capture. Refusing a decorative redraw is the cheap direction.
      console.error(`[fp/cover] tombstone read failed: ${child.error.message}`);
      return { ok: false };
    }
    const stamp = (child.data as { photo_consent_revoked_at?: unknown } | null)
      ?.photo_consent_revoked_at;
    revokedAt = typeof stamp === "string" ? stamp : null;
  }

  return { ok: true, rows, revokedAt };
}

function toConsentRows(data: unknown): PhotoConsentRow[] {
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    policyVersion: typeof r.policy_version === "string" ? r.policy_version : null,
    acceptedAt:
      typeof r.accepted_at === "string" || typeof r.accepted_at === "number"
        ? (r.accepted_at as string | number)
        : null,
    revokedAt:
      typeof r.revoked_at === "string" || typeof r.revoked_at === "number"
        ? (r.revoked_at as string | number)
        : null,
    // Raw jsonb, narrowed by the verdict itself (absent/malformed = no claim).
    evidence: r.evidence,
  }));
}

/* ------------------------------------------------------------- phase two */

/**
 * The terminal status of a TEMPLATE cover: `final`.
 *
 * ── WHY NOT `fallback_pending_regen` (v3 Unit 4 review, FIX 4) ──
 * That status is defined by migration 20260912120000 as "template cover shown,
 * background regen QUEUED". The first half was true; the second was a lie.
 * NOTHING in this build queues a regeneration, and no cron, reaper or backfill
 * anywhere reprocesses that status — so a family signing up during this window
 * would sit in a permanently-pending state, and plan Unit 7 (already written to
 * render it as "your cover is being drawn" and to expect a flip to `final`)
 * would show them a spinner that never resolves. A status must never describe
 * queued work that no queue exists to perform.
 *
 * ── WHY `final` IS THE HONEST ANSWER, NOT A CONVENIENT ONE ──
 * The deterministic SVG IS the finished artifact. It is not a placeholder
 * standing in for a "real" cover that failed: no generation failed, none was
 * attempted, and the picture is complete, personalized, and re-derivable from
 * columns the row already carries. When the AI adapter lands it will REDRAW
 * these covers — replacing a finished thing with a different finished thing, the
 * same operation as any parent-triggered redraw — not "complete" them.
 *
 * ⚠ NOTE FOR THE AI ADAPTER (plan Unit 7+): rows carrying `final` with a NULL
 * cover_blob_key are exactly the derived/template covers. They are the correct
 * backfill target if you ever want to redraw the template cohort — a null key
 * next to `final` is the durable, queryable marker, and it is much safer than a
 * status word, because it cannot be confused with an in-flight state. Do NOT
 * treat them as failures, and do NOT reintroduce `fallback_pending_regen` as a
 * "we mean to redraw this" flag unless a writer that actually performs the
 * redraw ships in the same change.
 *
 * ── WHY THIS IS SAFE AGAINST THE BLOB RULES ──
 * `final` is in `STATUSES_IMPLYING_COVER_BLOB`, but this write names NO key and
 * declares `source: "derived"` — the arm `decideCoverStatusWrite` documents as
 * "the picture does not live in the object store", and which REFUSES a derived
 * write that names a key. Since v3 Unit 7 the picture is not re-derived either:
 * it is PERSISTED in `cover_data_url` by the same statement that writes this
 * status. So the invariant rule (1) protects (never claim a picture that cannot
 * be produced) still holds by construction — the bytes are literally in the row.
 *
 * Consumers checked: `statusImpliesCoverBlob` (true, and correct — there IS a
 * picture), `decideCoverStatusWrite` derived arm (permits it, key-free),
 * `planCoverCarry` (no key + terminal ⇒ status AND artifact carried verbatim to
 * the child), `isTerminalCoverStatus` (true), `coverSettled` in
 * app/lib/v3-signup/v3-onboarding-core.ts (`!== "none"` ⇒ the flow resolver
 * moves the family past the cover step), and the migration CHECK list (already
 * contains `final`; no migration edit, no COVER_STATUSES change, no parity-test
 * churn).
 */
export const TEMPLATE_COVER_STATUS: CoverStatus = "final";

/** How many times the settle write may be retried before we stop claiming the
 *  row holds a status it does not. Small: the settle is a single unconditional
 *  UPDATE by primary key, so a transient fault clears immediately or not at all. */
export const COVER_SETTLE_RETRIES = 3;

export type CoverDoneEvent =
  | { kind: "ready"; coverUrl: string; status: CoverStatus; generationCount: number }
  | { kind: "refused"; reason: CoverRefusalReason; detail?: string };

export type CoverEmit = (event: { stage: CoverStage }) => void;

/**
 * Do the work. Called ONLY with an `AuthorizedCover`, which is the type-level
 * statement that every gate has already passed.
 *
 * Two durable transitions, two stage events, nothing in between:
 *   reserved  — the conditional UPDATE below took the generation slot;
 *   composed  — the SVG exists and the row has been settled.
 * There is no sleep, no easing, and no fabricated intermediate stage. The work
 * is fast because a deterministic template IS fast, and pretending otherwise
 * would be a lie told to a parent about what we are doing with their kid's data.
 */
export async function performCoverGeneration(
  deps: CoverDeps,
  authorized: AuthorizedCover,
  emit: CoverEmit
): Promise<CoverDoneEvent> {
  // A mode this build cannot perform was refused in PHASE ONE
  // (`decideGenerationFeasible`), before the reservation below could spend a
  // durable slot on it. The assertion here is a tripwire, not a gate: it must
  // never fire, and if it does the reason is that someone moved the feasibility
  // check rather than that a caller did something.
  if (authorized.mode !== "template") {
    console.error(
      `[fp/cover] BUG: phase two reached with mode "${authorized.mode}" — feasibility must be decided in phase one`
    );
    return { kind: "refused", reason: "outage" };
  }

  const reserved = await reserveGenerationSlot(deps, authorized);
  if (!reserved.ok) return { kind: "refused", reason: reserved.reason };
  emit({ stage: "reserved" });

  // ⚠ THE ONE RENDERER CALL SITE IN THE PRODUCT (v3 Unit 7, owner rework).
  // The cover is created HERE, once, during parent signup — and then it is
  // PERSISTED (below) and served verbatim forever after. Nothing downstream
  // re-renders: not provisioning, not either sign-in door, not First Profit.
  // If you are adding a second call to `renderTemplateCover` anywhere, stop:
  // a second render is a second picture, which is the bug this shape fixes.
  const render = deps.renderCover ?? renderTemplateCover;
  const coverUrl = render({
    firstName: authorized.firstName,
    age: authorized.age,
    answers: authorized.answers,
  });

  // Rule (1), the derived arm: this row is about to claim a picture, and it
  // proves it may by naming NO blob key. A `derived` write that named one would
  // be refused here rather than corrupting the reaper's view of the world.
  const allowed = decideCoverStatusWrite({
    status: TEMPLATE_COVER_STATUS,
    scope: "draft",
    ownerId: authorized.draftId,
    coverBlobKey: null,
    blobConfirmed: false,
    source: "derived",
  });
  if (!allowed.ok) {
    console.error(`[fp/cover] refused to settle draft ${authorized.draftId}: ${allowed.detail}`);
    return { kind: "refused", reason: "outage" };
  }

  const settled = await settleDraftCover(deps, authorized, coverUrl);
  if (!settled.ok) {
    // ── THE STRANDED-`generating` HAZARD, AND WHY THIS IS A REFUSAL ──
    // The reservation and the settle are two statements; between them the row
    // holds `generating`, which is the one NON-TERMINAL cover status and the one
    // nothing in this codebase advances. If the settle will not persist, the
    // previous behaviour returned `{ kind: "ready", status: "generating" }` —
    // the family saw a cover and no error, nothing retried, and if they then
    // finished signup the CHILD was minted `generating` forever.
    //
    // Both halves are now closed: `settleDraftCover` retries, and on exhaustion
    // it compensates the row back to a terminal status. What it can never do is
    // hand a caller a success carrying a state the row is stuck in, so the
    // outcome is an honest refusal. `outage` is right — this is our fault, not
    // the caller's — and it is the one refusal whose rate-limit strike is
    // refunded. The slot is spent; that is the cost of a durable counter, and
    // the family's remaining redraws still work.
    //
    // The backstop, for the case where even the compensation fails: the carry
    // (`planCoverCarry`) refuses to copy a non-terminal status onto a child, so
    // a stranded DRAFT can never mint a stranded CHILD.
    return { kind: "refused", reason: "outage" };
  }

  emit({ stage: "composed" });
  return {
    kind: "ready",
    coverUrl,
    status: TEMPLATE_COVER_STATUS,
    generationCount: reserved.count,
  };
}

/**
 * SETTLE THE ROW OFF `generating`, AND DO NOT GIVE UP QUIETLY.
 *
 * ── THIS IS ALSO WHERE THE PICTURE IS PERSISTED (v3 Unit 7, owner rework) ──
 * The rendered artifact is written in the SAME UPDATE that settles the status,
 * so `cover_status = 'final'` and the bytes that status claims can never be
 * written apart — there is no window in which a row says it has a cover that
 * nothing can produce, and none in which bytes sit beside a status that does
 * not mean them. The compensation nulls the artifact for exactly the same
 * reason. (This replaces the old "the cover is re-derivable, so store nothing"
 * design: it was only re-derivable from the DRAFT's name+age+answers, and the
 * draft is consumed at provisioning. See migration 20260917120000.)
 *
 * The write is a single UPDATE by primary key with FIXED values — no predicate
 * on anything we observed — so it is perfectly idempotent and retrying it is
 * free of race consequences. `COVER_SETTLE_RETRIES` attempts, then a
 * COMPENSATION: put the row back to `none`, the terminal "no cover here"
 * status, so a draft is never left in the one state nothing advances. `none`
 * needs no blob and claims no picture, so it is always a legal write.
 *
 * Zero affected rows is treated as SUCCESS, not failure: the only ways the
 * predicate stops matching are the draft being consumed (provisioning won the
 * race and the child already carries the cover) or reaped (deliberate). Neither
 * is a fault, and neither leaves a stranded `generating` row for us to fix.
 */
async function settleDraftCover(
  deps: CoverDeps,
  authorized: AuthorizedCover,
  coverUrl: string
): Promise<{ ok: true } | { ok: false }> {
  const write = (status: CoverStatus, dataUrl: string | null) =>
    authorized.db
      .from("fp_onboarding_drafts")
      .update({
        cover_status: status,
        // Explicitly nulled, not merely omitted: a re-run after a future
        // blob-backed generation must not leave the previous key behind on a row
        // whose picture is now derived.
        cover_blob_key: null,
        // The artifact itself, atomic with the status it belongs to.
        cover_data_url: dataUrl,
        updated_at: new Date(deps.now()).toISOString(),
      })
      .eq("id", authorized.draftId)
      .eq("parent_id", authorized.parentId)
      .eq("status", "active")
      .select("id");

  for (let i = 0; i < COVER_SETTLE_RETRIES; i += 1) {
    const res = await write(TEMPLATE_COVER_STATUS, coverUrl);
    if (!res.error) return { ok: true };
    console.error(
      `[fp/cover] settle write failed (attempt ${i + 1}/${COVER_SETTLE_RETRIES}) for draft ${authorized.draftId}: ${res.error.message}`
    );
  }

  // Compensation. The picture was never persisted, so `none` is the truth, and
  // it is a status the family's next redraw can move off normally. The artifact
  // is nulled with it — bytes beside a `none` status would be a picture no
  // reader is allowed to serve, which is just a leak with extra steps.
  const compensated = await write("none", null);
  if (compensated.error) {
    console.error(
      `[fp/cover] settle COMPENSATION failed for draft ${authorized.draftId}: ${compensated.error.message} — row may be stranded on 'generating'; planCoverCarry refuses to carry it to a child`
    );
  }
  return { ok: false };
}

/**
 * THE CAP, ENFORCED IN THE ROW.
 *
 * One conditional UPDATE whose predicate includes the count this request
 * OBSERVED (`.eq("generation_count", seen)`), so two concurrent redraws cannot
 * both write `seen + 1` — the loser matches zero rows, re-reads, and tries
 * again. This is the same compare-and-set-on-the-observed-value shape
 * verify-store uses for `code_guess_count`, and for the same reason: PostgREST
 * cannot express `set c = c + 1`, and a read-then-blind-write would let
 * concurrency hand a family unlimited generations.
 *
 * `.lt("generation_count", CAP)` rides along so the ceiling is a predicate the
 * DATABASE evaluates, not an assertion the application remembers to make.
 */
async function reserveGenerationSlot(
  deps: CoverDeps,
  authorized: AuthorizedCover
): Promise<{ ok: true; count: number } | { ok: false; reason: CoverRefusalReason }> {
  let seen = authorized.generationCount;
  for (let i = 0; i < COVER_RESERVE_CAS_RETRIES; i += 1) {
    const cap = decideGenerationCap({ generationCount: seen });
    if (!cap.ok) return { ok: false, reason: cap.reason };

    const casted = await authorized.db
      .from("fp_onboarding_drafts")
      .update({
        generation_count: cap.next,
        cover_status: "generating",
        // A redraw invalidates the previous picture the moment it takes the
        // slot: `generating` is not a status any reader serves a cover for, so
        // leaving the old artifact behind could only ever let a row disagree
        // with itself. The settle writes the new one; the compensation leaves
        // it null.
        cover_data_url: null,
        updated_at: new Date(deps.now()).toISOString(),
      })
      .eq("id", authorized.draftId)
      .eq("parent_id", authorized.parentId)
      .eq("status", "active")
      .eq("generation_count", seen)
      // The ceiling as a predicate the DATABASE evaluates, belt-and-braces with
      // the pure decision above: if this application ever forgets to check, the
      // statement still cannot write a count past the cap.
      .lt("generation_count", COVER_GENERATION_CAP)
      .select("id, generation_count");
    if (casted.error) {
      console.error(`[fp/cover] reservation CAS failed: ${casted.error.message}`);
      return { ok: false, reason: "outage" };
    }
    const rows = (casted.data as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 1) return { ok: true, count: cap.next };

    // Lost the race (or the draft stopped being active). Re-read and re-decide;
    // never assume what the winner wrote.
    const reread = await authorized.db
      .from("fp_onboarding_drafts")
      .select("generation_count, status")
      .eq("id", authorized.draftId)
      .eq("parent_id", authorized.parentId)
      .maybeSingle();
    if (reread.error) {
      console.error(`[fp/cover] reservation re-read failed: ${reread.error.message}`);
      return { ok: false, reason: "outage" };
    }
    const row = reread.data as Record<string, unknown> | null;
    if (!row || row.status !== "active") return { ok: false, reason: "not_found" };
    const current = row.generation_count;
    seen = typeof current === "number" && Number.isInteger(current) ? current : seen;
  }
  console.error(
    `[fp/cover] reservation CAS exhausted for draft ${authorized.draftId} — concurrent redraws`
  );
  return { ok: false, reason: "busy" };
}
