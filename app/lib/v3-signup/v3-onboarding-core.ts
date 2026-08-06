import "server-only";

/**
 * The v3 onboarding flow's SERVER side, steps 2 through 5 (plan Unit 3): the
 * draft row's CRUD, the add-another-kid loop's attempt + consent mint, and
 * provisioning. Deps-injected, `server-only`, deliberately NOT `"use server"` —
 * a core with a `deps` parameter may never live in a file whose every export is
 * client-callable (docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-server-action-boundary-2026-07-17.md). The thin
 * actions live in app/start/actions.ts.
 *
 * ── THE STATED INVARIANT: A LOOP-ENTRY ATTEMPT IS BORN 'verified' ──
 * `recordConsent` REFUSES a non-`verified` attempt, and `createChild` refuses
 * one that is not `verified` and owned by the caller. Both are correct: they
 * exist so an unverified stranger cannot record consent or mint a child. In v3
 * the parent has ALREADY proved inbox control at step 1 (the code redeem set
 * their FIRST attempt to `verified` and minted their cookie session), and step 2
 * needs a FRESH attempt per kid because `consentGate` binds one active consent
 * to one child per attempt (the partial unique index on `signup_attempt_id`).
 *
 * So the loop-entry attempt is INSERTED in state `verified`, with `parent_id`
 * already linked and `verified_at` stamped. This is not a bypass of the
 * verification gate — it is the gate's OUTPUT being carried forward:
 *   - it is only reachable from a live COOKIE SESSION, which only the code
 *     redeem can mint (app/lib/v3-signup/v3-signup-core.ts), so the inbox proof
 *     is a precondition of even calling this;
 *   - `parent_id` is taken from that session, never from the request body, so
 *     the row can only ever name the caller;
 *   - it carries NO verification secret at all (no code hash, no token hash, no
 *     expiry), so it is not a redeemable credential and there is nothing on it
 *     to brute-force. `code_guess_count` is set to 0 explicitly for the same
 *     reason the start path does it: a control that only exists when a DEFAULT
 *     fires is one an absent column silently disables.
 * A grep for `state: "verified"` outside this file and verify-store's redeem CAS
 * should find nothing; if it ever does, that is the thing to audit.
 *
 * ── DRAFT CONSUMPTION IS STAMPED ONLY AFTER createChild RETURNS ok ──
 * Stamping first would leave a `consumed` draft with no child whenever
 * child-core's reverse-order compensation fires, and the dashboard would then
 * show neither the draft nor a kid. So the order is: mint, THEN stamp. The
 * retry path is the mirror image — an UNCONSUMED draft whose attempt is already
 * `child_created` is the core's idempotent-replay case, and `createChild`
 * answers it with the existing `childId` and NO username (it did not mint one
 * this time), which is exactly why the username is re-read from the child record
 * rather than taken from the response.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordConsent } from "@/app/api/fp/signup/consent-core";
import { FP_CONSENT_POLICY, currentPolicyHash } from "@/app/api/fp/signup/consent-rules";
import type { CreateChildInput, CreateChildResult } from "@/app/api/fp/signup/child-core";
import { isTestSignup, type SignupGateEnv } from "@/app/api/fp/signup/signup-rules";
import {
  asStoredCoverDataUrl,
  planCoverCarry,
  planRedrawCarry,
  type CoverStatus,
  isCoverStatus,
} from "@/app/lib/fp/cover-store-rules";
import { buildChildPassword } from "./credentials-rules";
import {
  ageBandForAge,
  findDuplicateKid,
  validateKidInput,
  type ExistingKid,
  type V3FlowFacts,
} from "./flow-rules";
import {
  parseV3AddKid,
  parseV3EditKid,
  parseV3Provision,
  parseV3SaveStory,
} from "./v3-onboarding-rules";
// The question ids + the per-answer cap. A pure data module with no imports of
// its own, and a SIBLING of this file since review FIX 9b — a `server-only` core
// in app/lib must not import from a route folder, and the duplicate id list
// credentials-rules.ts kept to dodge that coupling is now gone.
import { STORY_ANSWER_MAX_CHARS, STORY_QUESTION_IDS } from "./story-questions";

/**
 * The jurisdiction stamped on a v3 consent record. The v3 form deliberately does
 * NOT ask (the FP HTTP door does, because its SPA collects a full consent form);
 * every v3 family signs up through the120.school, a Toronto operation, so the
 * record states the operator's jurisdiction rather than guessing the parent's
 * from an IP. If that ever needs to be the PARENT's jurisdiction, it has to
 * become a field on the form — inferring it would put a guess into a legal
 * evidence record.
 */
export const V3_CONSENT_JURISDICTION = "CA-ON";

/**
 * The per-parent ceiling on LIVE (status `active`) drafts (review FIX 7).
 *
 * `MAX_CHILDREN_PER_FAMILY` (10, in child-core) only bites at PROVISIONING time,
 * which is far too late to matter here: every `v3AddKid` with `differentChild:
 * true` mints an attempt + a consent record + a draft row BEFORE any child is
 * created, so one verified session could loop the action and accumulate an
 * unbounded litter of rows carrying minors' names. The DB's partial unique index
 * (migration 20260915120000) bounds duplicates by NAME; this bounds the number
 * of distinct names in flight, and it is deliberately the SAME number as the
 * family cap — a family that legitimately needs an eleventh live draft is a
 * family `createChild` would refuse anyway.
 *
 * Counted on `active` only: `consumed` drafts are finished work bounded by the
 * child cap, and `reaped` drafts are tombstones.
 */
export const V3_MAX_ACTIVE_DRAFTS_PER_PARENT = 10;

/* ------------------------------------------------------------------- deps */

export type V3OnboardingDeps = {
  /** Service-role client. fp_onboarding_drafts, fp_signup_attempts and
   *  fp_parental_consent are ALL RLS-on with ZERO policies (service-role only),
   *  so there is no session-scoped client that could read them; every function
   *  here re-derives the parent id from the session at the action boundary and
   *  scopes every query by it explicitly. */
  db: SupabaseClient;
  /** `createChild`, injected so tests never reach the real signup core and so
   *  this module owns sequencing rather than child creation. */
  createChild: (input: CreateChildInput) => Promise<CreateChildResult>;
  /**
   * Unit 4 SEAM. Copy a draft's cover object to the child's namespace. Absent
   * (today) means no cover has been generated yet, so nothing is ever carried;
   * `planCoverCarry` already answers `copy: null` for an unsettled cover, and
   * the child's cover columns are written from the plan regardless. Unit 4 wires
   * the real Blob copy here and nothing else in this file changes.
   */
  copyCoverBlob?: (input: { from: string; to: string }) => Promise<{ ok: boolean }>;
  now: () => number;
  /** `[0, 1)` source for the per-kid password fallback. CSPRNG in production. */
  random: () => number;
  env: SignupGateEnv;
};

const nowIso = (deps: V3OnboardingDeps) => new Date(deps.now()).toISOString();

/* ------------------------------------------------------------- draft view */

export type V3DraftView = {
  id: string;
  attemptId: string | null;
  childId: string | null;
  firstName: string;
  lastName: string;
  age: number | null;
  answers: Record<string, string>;
  coverStatus: CoverStatus;
  coverBlobKey: string | null;
  /** The rendered cover stored by POST /api/fp/cover (v3 Unit 7). Carried to
   *  the child verbatim; never re-rendered anywhere. */
  coverDataUrl: string | null;
  generationCount: number;
  status: "active" | "consumed" | "reaped";
};

type DraftRow = Record<string, unknown>;

/** Narrow one untyped service-role row, `parseCandidateRow`-style: never coerce
 *  a malformed row into a trusted view. */
function parseDraftRow(row: DraftRow | null): V3DraftView | null {
  if (!row || typeof row.id !== "string") return null;
  const status = row.status;
  if (status !== "active" && status !== "consumed" && status !== "reaped") return null;
  const rawAnswers = row.answers;
  const answers: Record<string, string> = {};
  if (rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)) {
    for (const [k, v] of Object.entries(rawAnswers as Record<string, unknown>)) {
      if (typeof v === "string") answers[k] = v;
    }
  }
  const age = row.kid_age;
  return {
    id: row.id,
    attemptId: typeof row.signup_attempt_id === "string" ? row.signup_attempt_id : null,
    childId: typeof row.child_id === "string" ? row.child_id : null,
    firstName: typeof row.kid_first_name === "string" ? row.kid_first_name : "",
    lastName: typeof row.kid_last_name === "string" ? row.kid_last_name : "",
    age: typeof age === "number" && Number.isInteger(age) ? age : null,
    answers,
    coverStatus: isCoverStatus(row.cover_status) ? row.cover_status : "none",
    coverBlobKey: typeof row.cover_blob_key === "string" ? row.cover_blob_key : null,
    // Gated on the way OUT of the database, not merely narrowed: this value
    // ends up in an `<img src>` in a child's browser, so the one shape it may
    // take is checked at every boundary it crosses.
    coverDataUrl: asStoredCoverDataUrl(row.cover_data_url),
    generationCount:
      typeof row.generation_count === "number" && Number.isInteger(row.generation_count)
        ? row.generation_count
        : 0,
    status,
  };
}

const DRAFT_COLUMNS =
  "id, signup_attempt_id, child_id, kid_first_name, kid_last_name, kid_age, answers, cover_status, cover_blob_key, cover_data_url, generation_count, status, updated_at";

/* ------------------------------------------------------------------- load */

export type V3OnboardingState = {
  /** The draft this flow is standing on: the parent's most recently touched
   *  ACTIVE draft. A `consumed` draft is finished work and never resumed. */
  draft: V3DraftView | null;
  /** Existing kids — provisioned children AND other live drafts — for the
   *  duplicate guard and the dashboard-style "resume" offer. */
  existingKids: ExistingKid[];
  facts: V3FlowFacts;
};

/**
 * Everything the page needs to render a resumed flow. Read failures degrade to
 * an empty state rather than an error screen: the worst case is that a family
 * re-enters their kid's name, which the duplicate guard then catches.
 */
/**
 * The READ half of the deps — a client and nothing else.
 *
 * Narrower than `V3OnboardingDeps` on purpose: the page renders this load, and a
 * React render may not hold a clock or a CSPRNG (both are impure, and the repo's
 * `react-hooks/purity` lint says so). It also means the render is handed no
 * `createChild` it could be tempted to call.
 */
export type V3OnboardingReadDeps = Pick<V3OnboardingDeps, "db">;

export async function loadV3OnboardingState(
  deps: V3OnboardingReadDeps,
  input: { parentId: string; parentVerified: boolean }
): Promise<V3OnboardingState> {
  const empty: V3OnboardingState = {
    draft: null,
    existingKids: [],
    facts: {
      parentVerified: input.parentVerified,
      hasDraft: false,
      kidNamed: false,
      coverSettled: false,
      storyStarted: false,
      childCreated: false,
    },
  };
  if (!input.parentVerified) return empty;

  const drafts = await deps.db
    .from("fp_onboarding_drafts")
    .select(DRAFT_COLUMNS)
    .eq("parent_id", input.parentId)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (drafts.error) {
    console.error(`[fp/v3-onboarding] draft load failed: ${drafts.error.message}`);
    return empty;
  }
  const rows = ((drafts.data as DraftRow[] | null) ?? [])
    .map(parseDraftRow)
    .filter((d): d is V3DraftView => d !== null);
  const draft = rows.find((d) => d.status === "active") ?? null;

  const children = await deps.db
    .from("children")
    .select("id, first_name, last_name")
    .eq("parent_id", input.parentId)
    .limit(50);
  if (children.error) {
    console.error(`[fp/v3-onboarding] children load failed: ${children.error.message}`);
  }

  const existingKids: ExistingKid[] = [
    ...(((children.data as Array<Record<string, unknown>> | null) ?? [])
      .filter((c) => typeof c.id === "string")
      .map((c) => ({
        id: String(c.id),
        kind: "child" as const,
        firstName: typeof c.first_name === "string" ? c.first_name : "",
        lastName: typeof c.last_name === "string" ? c.last_name : "",
      }))),
    // Live drafts OTHER than the one being resumed: adding the resumed draft
    // itself would make every family "a duplicate of themselves" the moment
    // they re-submit the kid step to correct a typo.
    ...rows
      .filter((d) => d.status === "active" && d.id !== draft?.id)
      .map((d) => ({ id: d.id, kind: "draft" as const, firstName: d.firstName, lastName: d.lastName })),
  ];

  return {
    draft,
    existingKids,
    facts: {
      parentVerified: true,
      hasDraft: draft !== null,
      kidNamed: draft !== null && draft.firstName.trim().length > 0 && draft.age !== null,
      coverSettled: draft !== null && draft.coverStatus !== "none",
      storyStarted:
        draft !== null && Object.values(draft.answers).some((a) => a.trim().length > 0),
      childCreated: draft !== null && draft.childId !== null,
    },
  };
}

/* ------------------------------------------------- existing-kid lookup */

/**
 * Every kid this parent already has — provisioned children AND every LIVE draft,
 * including the one the flow is currently standing on.
 *
 * Deliberately NOT `loadV3OnboardingState().existingKids`, which EXCLUDES the
 * resumed draft (so that correcting a typo on your own in-progress kid does not
 * trip the guard). That exclusion is right for the pre-check and wrong for the
 * 23505 arbiter in `v3AddKid`: the row the index just refused us may well BE the
 * most recently touched active draft, and answering "no duplicate found" there
 * would turn the DB's authoritative refusal into a generic failure.
 */
async function loadAllExistingKids(
  deps: V3OnboardingReadDeps,
  parentId: string
): Promise<ExistingKid[]> {
  const [children, drafts] = await Promise.all([
    deps.db.from("children").select("id, first_name, last_name").eq("parent_id", parentId).limit(50),
    deps.db
      .from("fp_onboarding_drafts")
      .select(DRAFT_COLUMNS)
      .eq("parent_id", parentId)
      .eq("status", "active")
      .limit(50),
  ]);
  if (children.error) {
    console.error(`[fp/v3-onboarding] existing children read failed: ${children.error.message}`);
  }
  if (drafts.error) {
    console.error(`[fp/v3-onboarding] existing drafts read failed: ${drafts.error.message}`);
  }
  return [
    ...((children.data as Array<Record<string, unknown>> | null) ?? [])
      .filter((c) => typeof c.id === "string")
      .map((c) => ({
        id: String(c.id),
        kind: "child" as const,
        firstName: typeof c.first_name === "string" ? c.first_name : "",
        lastName: typeof c.last_name === "string" ? c.last_name : "",
      })),
    ...((drafts.data as DraftRow[] | null) ?? [])
      .map(parseDraftRow)
      .filter((d): d is V3DraftView => d !== null)
      .map((d) => ({
        id: d.id,
        kind: "draft" as const,
        firstName: d.firstName,
        lastName: d.lastName,
      })),
  ];
}

/* --------------------------------------------------------------- add kid */

export type V3AddKidResult =
  | { kind: "added"; draftId: string }
  /** The parent already has a kid by this name. The UI offers "Resume <name>"
   *  vs "This is a different child"; the latter re-submits with
   *  `differentChild: true`. */
  | { kind: "duplicate"; kid: ExistingKid }
  | { kind: "invalid"; field: "name" | "age"; message: string }
  /** The consent echo did not bind to the text we render (stale bundle after a
   *  policy deploy, or a tampered payload). The UI reloads the policy. */
  | { kind: "consent_refused"; reason: string }
  /** The parent already has `V3_MAX_ACTIVE_DRAFTS_PER_PARENT` live drafts. A
   *  budget, not a product limit — see the constant. */
  | { kind: "capped" }
  | { kind: "failed" };

/**
 * The SERVER-ATTESTED context every step-2..5 core takes. None of it may come
 * from the request body: `parentId`/`parentEmail` are read from the cookie
 * session by the action, and `ip`/`ua` from the request headers.
 */
export type V3ParentContext = {
  parentId: string;
  parentEmail: string;
  /** The parent's Supabase access token — `createChild` inserts the child row
   *  under an RLS-scoped client built from it, never the service-role client. */
  parentToken: string;
  ip: string;
  ua: string;
};

/**
 * Step 2. Mints, in order: the per-kid attempt (state `verified` — see the
 * module header), the per-kid consent record, and the draft row.
 *
 * ORDERING AND THE COST OF EACH FAILURE. There is no transaction across these
 * three writes, so the order is chosen by what a half-finished sequence leaves
 * behind:
 *   - attempt alone → an inert row with no secret, reaped like any other;
 *   - attempt + consent, no draft → a consent record bound to an attempt that
 *     never mints a child. Harmless: `consentGate` only ever reads it through
 *     the attempt, and the family's retry mints a fresh pair.
 * The reverse order is NOT available: `recordConsent` needs the attempt id, and
 * the draft's `signup_attempt_id` FK wants the attempt to exist. Nothing here
 * touches a child, so there is nothing to compensate. (Draft-FIRST would give
 * exactly-one of all three under a race, but it trades that for a far worse
 * failure: a draft with no attempt is a draft `v3ProvisionKid` can never mint
 * from — `!draft.attemptId` is `no_draft` — and the unique index would then keep
 * refusing the family's retries. Litter that reaps itself beats a wedge.)
 *
 * ── THE DATABASE IS THE DUPLICATE ARBITER, NOT THE PRE-CHECK (review FIX 2) ──
 * `findDuplicateKid` over a just-read snapshot is CHECK-THEN-ACT: two tabs (or
 * one double-click, or a retried flaky POST) both read an empty state, both pass
 * the guard, and each mints its own attempt + consent + draft. Because
 * `consentGate` binds per ATTEMPT and `createChild`'s idempotency key IS the
 * attempt id, those two drafts then reach `v3ProvisionKid` independently and
 * mint DISTINCT children, auth accounts and `path_student_profiles` rows — two
 * live logins and two consent records for one child.
 *
 * So the pre-check is now only a FAST PATH that produces a good message, and the
 * real arbiter is a PARTIAL UNIQUE INDEX on
 * `(parent_id, lower(kid_first_name), lower(kid_last_name)) WHERE status =
 * 'active'` (migration 20260915120000). Its 23505 is treated as the
 * AUTHORITATIVE duplicate/resume outcome — exactly how `pickUniqueUsername` and
 * `createChild` already treat the username index's 23505 as the real answer
 * rather than an error.
 */
export async function v3AddKid(
  deps: V3OnboardingDeps,
  body: unknown,
  ctx: V3ParentContext
): Promise<V3AddKidResult> {
  const parsed = parseV3AddKid(body);
  if (!parsed.ok) return { kind: "failed" };
  const input = parsed.data;

  const verdict = validateKidInput({ fullName: input.fullName, age: input.age });
  if (!verdict.ok) return { kind: "invalid", field: verdict.field, message: verdict.message };

  // Fail fast on a stale/tampered consent echo BEFORE minting anything: an
  // attempt row whose consent will certainly be refused is pure litter.
  if (
    input.consentVersion !== FP_CONSENT_POLICY.version ||
    input.consentHash !== currentPolicyHash()
  ) {
    return { kind: "consent_refused", reason: "stale_or_tampered_echo" };
  }

  if (!input.differentChild) {
    const state = await loadV3OnboardingState(deps, {
      parentId: ctx.parentId,
      parentVerified: true,
    });
    // The draft being resumed is excluded from `existingKids` by the loader, so
    // correcting a typo on your own in-progress kid never trips the guard.
    // FAST PATH ONLY — the index below is what actually decides (see header).
    const dup = findDuplicateKid(
      { firstName: verdict.firstName, lastName: verdict.lastName },
      state.existingKids
    );
    if (dup) return { kind: "duplicate", kid: dup };
  }

  // ── the per-parent live-draft budget (review FIX 7) ──
  // Counted BEFORE the attempt is minted, so a refused add leaves nothing at
  // all behind. A read failure fails CLOSED for the same reason the cap exists:
  // an uncountable budget is not a budget.
  const liveDrafts = await deps.db
    .from("fp_onboarding_drafts")
    .select("id")
    .eq("parent_id", ctx.parentId)
    .eq("status", "active")
    .limit(V3_MAX_ACTIVE_DRAFTS_PER_PARENT + 1);
  if (liveDrafts.error) {
    console.error(`[fp/v3-onboarding] live-draft count failed: ${liveDrafts.error.message}`);
    return { kind: "failed" };
  }
  if (((liveDrafts.data as unknown[] | null) ?? []).length >= V3_MAX_ACTIVE_DRAFTS_PER_PARENT) {
    console.error(
      `[fp/v3-onboarding] parent ${ctx.parentId} is at the live-draft cap (${V3_MAX_ACTIVE_DRAFTS_PER_PARENT})`
    );
    return { kind: "capped" };
  }

  const stamp = nowIso(deps);
  const attempt = await deps.db
    .from("fp_signup_attempts")
    .insert({
      parent_email: ctx.parentEmail,
      parent_id: ctx.parentId,
      // See the module header. Born verified, carrying no secret.
      state: "verified",
      verified_at: stamp,
      is_test: isTestSignup(ctx.parentEmail, deps.env),
      ip: ctx.ip,
      ua: ctx.ua,
      code_guess_count: 0,
    })
    .select("id")
    .single();
  if (attempt.error || !attempt.data) {
    console.error(`[fp/v3-onboarding] attempt insert failed: ${attempt.error?.message ?? "no row"}`);
    return { kind: "failed" };
  }
  const attemptId = String((attempt.data as { id: unknown }).id);

  const consent = await recordConsent(deps.db, {
    attemptId,
    parentId: ctx.parentId,
    echoedVersion: input.consentVersion,
    echoedHash: input.consentHash,
    method: "email_plus_attestation",
    childAgeBand: ageBandForAge(verdict.age),
    jurisdiction: V3_CONSENT_JURISDICTION,
    ip: ctx.ip,
    ua: ctx.ua,
  });
  if (!consent.ok) {
    console.error(`[fp/v3-onboarding] recordConsent refused: ${consent.reason} (attempt ${attemptId})`);
    return consent.reason === "outage"
      ? { kind: "failed" }
      : { kind: "consent_refused", reason: consent.reason };
  }

  const draft = await deps.db
    .from("fp_onboarding_drafts")
    .insert({
      parent_id: ctx.parentId,
      signup_attempt_id: attemptId,
      kid_first_name: verdict.firstName,
      kid_last_name: verdict.lastName,
      kid_age: verdict.age,
      status: "active",
      updated_at: stamp,
    })
    .select("id")
    .single();
  if (draft.error || !draft.data) {
    // ── COMPENSATE ON *EVERY* LOSING BRANCH (whole-branch review, finding 3) ──
    // The draft is the LAST of three inserts. When it does not land — because
    // the partial unique index gave the race to another tab, or because the
    // write simply failed — the attempt and the consent row minted moments ago
    // are attached to NOTHING. The consent row is the sharp end: it is legal
    // evidence, minted alongside a live affirmation, and an orphan of it is
    // litter with no cleanup path and no meaning. Both branches below therefore
    // unwind, mirroring signup-core's `abort()` compensation.
    const code = (draft.error as { code?: unknown } | null)?.code;
    await compensateAddKid(deps, attemptId, code === "23505" ? "duplicate" : "draft-insert");

    // 23505 = the partial unique index fired: another call (another tab, a
    // double-click, a retried POST) already holds an ACTIVE draft for this
    // parent + kid name. That is not an error — it is the authoritative answer
    // to the question this function asked, and it is the ONLY answer that
    // survives a race. Re-read and hand back the winner.
    if (code === "23505") {
      const existing = await loadAllExistingKids(deps, ctx.parentId);
      const dup = findDuplicateKid(
        { firstName: verdict.firstName, lastName: verdict.lastName },
        existing
      );
      if (dup) return { kind: "duplicate", kid: dup };
      // The index refused us but the re-read cannot see the row that refused
      // us (a read replica, or a status flip in between). Never invent an
      // `added` we did not make.
      console.error(
        `[fp/v3-onboarding] draft insert hit 23505 for parent ${ctx.parentId} but no matching kid was re-read`
      );
      return { kind: "failed" };
    }
    console.error(`[fp/v3-onboarding] draft insert failed: ${draft.error?.message ?? "no row"}`);
    return { kind: "failed" };
  }
  return { kind: "added", draftId: String((draft.data as { id: unknown }).id) };
}

/**
 * Unwind a losing `v3AddKid`: the consent row this call recorded, then the
 * attempt it was recorded against (whole-branch review, finding 3).
 *
 * ── WHY DELETE, NOT `markAttemptAbandoned` ──
 * signup-core's `abort()` marks the attempt `abandoned`, and that vocabulary is
 * load-bearing over there: `state='abandoned' AND parent_id IS NOT NULL` is the
 * documented ops query for "a compensation `deleteUser` failed and a real auth
 * account is stranded". Reusing it here would manufacture false positives on
 * that query — this attempt's parent account is the CALLER's, alive, signed in
 * and entirely fine. (The CAS would also refuse: `markAbandoned` requires
 * `state='started'`, and a loop-entry attempt is born `verified`.) So the rows
 * are removed instead. Nothing of value is lost: the attempt carries no
 * verification secret and no child, and the consent affirms a kid record that
 * never came into being.
 *
 * ── ORDER: CONSENT FIRST ──
 * `fp_parental_consent.signup_attempt_id` is ON DELETE SET NULL. Deleting the
 * attempt first would null the only link and leave the consent row permanently
 * unfindable by attempt — the exact orphan this function exists to prevent.
 *
 * ── AND IF THE UNWIND ITSELF FAILS ──
 * It is logged in the STRANDED vocabulary and left. The draft reaper's orphan
 * sweep (app/lib/v3-signup/draft-reaper-rules.ts) is the backstop: it collects
 * attempts that never reached a draft or a child once they are past its age
 * bound, together with their consent rows. Compensation is the fast path; the
 * sweep is the guarantee.
 */
async function compensateAddKid(
  deps: V3OnboardingDeps,
  attemptId: string,
  stage: string
): Promise<void> {
  const consent = await deps.db
    .from("fp_parental_consent")
    .delete()
    .eq("signup_attempt_id", attemptId)
    .select("id");
  if (consent.error) {
    console.error(
      `[fp/v3-onboarding] STRANDED CONSENT for attempt ${attemptId} (compensating ${stage}): ${consent.error.message} — orphaned consent evidence; the draft reaper's orphan sweep is the backstop`
    );
    // The attempt is deliberately LEFT: it is the only handle the sweep (and an
    // operator) has for finding that consent row again.
    return;
  }
  const attempt = await deps.db
    .from("fp_signup_attempts")
    .delete()
    .eq("id", attemptId)
    .select("id");
  if (attempt.error) {
    console.error(
      `[fp/v3-onboarding] STRANDED ATTEMPT ${attemptId} (compensating ${stage}): ${attempt.error.message} — orphaned attempt; the draft reaper's orphan sweep is the backstop`
    );
  }
}

/* ------------------------------------------------------------- edit / save */

/** Every draft write goes through here so `updated_at` — the REAPING CLOCK —
 *  can never be forgotten by one call site (migration 20260912120000's warning).
 *  Scoped by parent_id AND status='active' in the WHERE, so a caller can only
 *  ever touch their own live draft, and a consumed draft is immutable. */
async function writeDraft(
  deps: V3OnboardingDeps,
  input: { parentId: string; draftId: string; patch: Record<string, unknown> }
): Promise<boolean> {
  const res = await deps.db
    .from("fp_onboarding_drafts")
    .update({ ...input.patch, updated_at: nowIso(deps) })
    .eq("id", input.draftId)
    .eq("parent_id", input.parentId)
    .eq("status", "active")
    .select("id");
  if (res.error) {
    console.error(`[fp/v3-onboarding] draft write failed: ${res.error.message}`);
    return false;
  }
  return ((res.data as unknown[] | null) ?? []).length === 1;
}

export type V3SaveResult = { kind: "saved" } | { kind: "failed" };

/** Step 2 correction (back-navigation): re-name / re-age the SAME draft rather
 *  than minting a second one. The attempt and consent already recorded stay
 *  bound — they are consent for THIS kid, and a typo fix is not a new child. */
export async function v3EditKid(
  deps: V3OnboardingDeps,
  body: unknown,
  ctx: V3ParentContext
): Promise<V3AddKidResult> {
  const parsed = parseV3EditKid(body);
  if (!parsed.ok) return { kind: "failed" };
  const input = parsed.data;
  const verdict = validateKidInput({ fullName: input.fullName, age: input.age });
  if (!verdict.ok) return { kind: "invalid", field: verdict.field, message: verdict.message };
  const ok = await writeDraft(deps, {
    parentId: ctx.parentId,
    draftId: input.draftId,
    patch: {
      kid_first_name: verdict.firstName,
      kid_last_name: verdict.lastName,
      kid_age: verdict.age,
    },
  });
  return ok ? { kind: "added", draftId: input.draftId } : { kind: "failed" };
}

/**
 * Step 4. The answers are OPTIONAL, so an empty sheet is a legitimate save.
 * Only KNOWN question ids are stored (an unknown key would be a caller writing
 * arbitrary jsonb into a row we later read), and each answer is bounded.
 */
export async function v3SaveStory(
  deps: V3OnboardingDeps,
  body: unknown,
  ctx: V3ParentContext
): Promise<V3SaveResult> {
  const parsed = parseV3SaveStory(body);
  if (!parsed.ok) return { kind: "failed" };
  const input = parsed.data;
  const clean: Record<string, string> = {};
  for (const id of STORY_QUESTION_IDS) {
    const raw = input.answers?.[id];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) clean[id] = trimmed.slice(0, STORY_ANSWER_MAX_CHARS);
  }
  const ok = await writeDraft(deps, {
    parentId: ctx.parentId,
    draftId: input.draftId,
    patch: { answers: clean },
  });
  return ok ? { kind: "saved" } : { kind: "failed" };
}

/* ------------------------------------------------------------ provisioning */

export type V3ProvisionResult =
  | {
      kind: "provisioned";
      childId: string;
      username: string;
      /** Shown ONCE, on the account-ready screen, and never persisted anywhere
       *  in plaintext. The only later recovery path is the dashboard's per-kid
       *  reset (plan Unit 8) — which is exactly why that unit is not optional. */
      password: string;
      firstName: string;
    }
  /** The mint refused for a reason a retry cannot fix on its own (consent gone
   *  stale, the family cap, a rejected name). Rendered with the reason. */
  | { kind: "refused"; reason: string; detail?: string }
  /** Infrastructure. The screen offers RETRY, and the retry re-invokes with the
   *  SAME attempt id — the idempotent-replay path. */
  | { kind: "retryable" }
  | { kind: "failed" };

/**
 * Step 5. Mint the child from the draft.
 *
 * RETRY IS THE SAME CALL. `createChild` is keyed on the attempt, and a second
 * call after a lost response lands on its idempotent-replay branch: it returns
 * the existing `childId` and NO `username`, because it did not mint one this
 * time. So the username is ALWAYS re-read from the child record when the
 * response does not carry it — never defaulted, never re-derived (re-deriving
 * would produce a DIFFERENT handle after a collision suffix and show the family
 * a login that does not exist).
 *
 * THE PASSWORD ON A REPLAY. A replay cannot recover the password — it was never
 * stored, by design. The screen therefore re-mints the SAME deterministic
 * candidate from the same answers... which it cannot guarantee either, because
 * the fallback is random. This is handled honestly: on a replay the password
 * field is absent and the screen tells the family to set one from the dashboard
 * (Unit 8's per-kid reset). It is a rare path — a lost response on the ONE call
 * that mints — and inventing a password we did not set would be worse.
 */
export async function v3ProvisionKid(
  deps: V3OnboardingDeps,
  body: unknown,
  ctx: V3ParentContext
): Promise<V3ProvisionResult> {
  const parsed = parseV3Provision(body);
  if (!parsed.ok) return { kind: "failed" };
  const found = await deps.db
    .from("fp_onboarding_drafts")
    .select(DRAFT_COLUMNS)
    .eq("id", parsed.data.draftId)
    .eq("parent_id", ctx.parentId)
    .maybeSingle();
  if (found.error) {
    console.error(`[fp/v3-onboarding] provision draft read failed: ${found.error.message}`);
    return { kind: "retryable" };
  }
  const draft = parseDraftRow(found.data as DraftRow | null);
  if (!draft || !draft.attemptId || draft.firstName.trim().length === 0) {
    return { kind: "refused", reason: "no_draft" };
  }

  const credential = buildChildPassword({
    childName: `${draft.firstName} ${draft.lastName}`.trim(),
    answers: draft.answers,
    random: deps.random,
  });

  const minted = await deps.createChild({
    attemptId: draft.attemptId,
    parentToken: ctx.parentToken,
    firstName: draft.firstName,
    lastName: draft.lastName,
    childPassword: credential.password,
  });

  if (!minted.ok) {
    // `outage` is the core's word for "our side failed" — the only refusal a
    // plain retry can clear. Everything else is terminal for this attempt and
    // is surfaced with its reason.
    if (minted.reason === "outage") return { kind: "retryable" };
    return { kind: "refused", reason: minted.reason, detail: minted.detail };
  }

  const childId = minted.childId;
  // Replay returns no username. Re-read it from the row rather than re-deriving.
  let username = minted.username ?? "";
  if (username.length === 0) {
    const row = await deps.db
      .from("children")
      .select("fp_username")
      .eq("id", childId)
      .maybeSingle();
    const value = (row.data as { fp_username?: unknown } | null)?.fp_username;
    if (typeof value === "string") username = value;
  }
  if (username.length === 0) {
    // The child exists and is playable, but we cannot show a login. Do NOT
    // pretend to have one — the family needs the dashboard's recovery path.
    console.error(
      `[fp/v3-onboarding] child ${childId} minted with no readable fp_username — account-ready screen cannot show a login`
    );
  }

  // ── the cover carry (Unit 4 seam; Unit 7 owner rework) ──
  // The plan is computed from the DRAFT's own columns. On today's template path
  // `copy` is null (no blob key was ever written) and the carry's real work is
  // moving the RENDERED ARTIFACT — `cover_data_url` → `fp_cover_data_url` — onto
  // the child alongside the status and the count. That copy of the bytes IS the
  // owner requirement: the picture the parent was shown at signup is the picture
  // the kid sees in First Profit, because it is literally the same string, and
  // nothing downstream of here has a renderer to disagree with.
  // Two-store rule (1) still governs the blob path: the child row only claims a
  // status implying a blob AFTER the copy is confirmed, so a failed/absent copy
  // degrades the child to `none` rather than pointing at bytes that are not there.
  const carry = planCoverCarry({
    draftId: draft.id,
    childId,
    draftCoverKey: draft.coverBlobKey,
    draftCoverStatus: draft.coverStatus,
    draftGenerationCount: draft.generationCount,
    draftCoverDataUrl: draft.coverDataUrl,
  });
  let coverFields = carry.child;
  if (carry.copy) {
    const copied = deps.copyCoverBlob ? await deps.copyCoverBlob(carry.copy) : { ok: false };
    if (!copied.ok) {
      console.error(
        `[fp/v3-onboarding] cover carry copy failed/unsupported for child ${childId} — child keeps no cover (decoration never fails provisioning)`
      );
      coverFields = {
        fp_cover_blob_key: null,
        fp_cover_status: "none",
        fp_cover_generation_count: carry.child.fp_cover_generation_count,
        // `none` claims no picture, so it may carry no bytes either.
        fp_cover_data_url: null,
      };
    }
  }
  // ── the REDRAW inputs carry (Unit 8, owner request; migration 20260918120000) ──
  // Age and answers live ONLY on the draft, and the reaper deletes drafts after
  // 30 days. Without this line every child provisioned today would be
  // permanently un-redrawable — the deferred AI adapter needs name + age +
  // answers, and the name alone yields a different picture. Written in the SAME
  // statement as the cover fields (one UPDATE, one failure mode) but computed
  // SEPARATELY: they are true about the kid whatever happened to the picture,
  // and a child whose cover degraded to `none` is the one who most needs a
  // redraw.
  const redraw = planRedrawCarry({
    draftKidAge: draft.age,
    draftAnswers: draft.answers,
  });
  const coverWrite = await deps.db
    .from("children")
    .update({ ...coverFields, ...redraw })
    .eq("id", childId);
  if (coverWrite.error) {
    // DECORATION NEVER FAILS PROVISIONING (plan: System-Wide Impact). Logged
    // and moved past; the child is minted and playable.
    console.error(`[fp/v3-onboarding] cover column write failed for child ${childId}: ${coverWrite.error.message}`);
  }

  // ── consumption, LAST ──
  const stamped = await writeDraft(deps, {
    parentId: ctx.parentId,
    draftId: draft.id,
    patch: { status: "consumed", child_id: childId },
  });
  if (!stamped) {
    // The child is real. An unstamped draft is a reconciliation problem (the
    // reaper skips it while it is fresh, and it is `active` with a child that
    // exists), never a reason to fail a successful mint.
    console.error(
      `[fp/v3-onboarding] STRANDED DRAFT ${draft.id}: child ${childId} minted but consumption stamp failed — needs manual status='consumed', child_id=${childId}`
    );
  }

  return {
    kind: "provisioned",
    childId,
    username,
    password: minted.username ? credential.password : "",
    firstName: draft.firstName,
  };
}
