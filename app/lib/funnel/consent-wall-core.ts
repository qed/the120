import "server-only";

/**
 * THE CONSENT WALL's impure half (founder, 2026-08-10): the reads behind
 * ./consent-wall-rules.ts, the shared `requireConsentClear` control every
 * consequential parent action calls, and the accept / decline recorders.
 *
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable (docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-server-action-boundary-2026-07-17.md). The thin
 * actions live in app/consent/actions.ts.
 *
 * ── SERVICE ROLE, WITH THE SESSION-DERIVED PARENT ID IN EVERY WHERE CLAUSE ──
 * `fp_parental_consent` is RLS-on with ZERO policies (Decision 1), so a session
 * client cannot read it at all. Per docs/solutions/security-issues/rls-enabled-
 * zero-policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md the
 * access story must name its client: this one is `supabaseAdmin`, and the access
 * control the absent policies would be is the `parent_id` predicate that rides
 * in every query below. Nothing here ever reads an id from a request body.
 *
 * ── ⚠ THE WALL FAILS OPEN, ON PURPOSE ──
 * Every read failure, every throw, resolves to "this parent is CLEAR". A wall is
 * a total blockade of a paying family's dashboard AND of their password-reset
 * and withdraw-consent controls; erecting one because Postgres hiccuped would
 * turn a transient outage into a support incident for every family at once. The
 * cohort this exists for (six families with literally no consent row) is a fixed,
 * known set — it will still be there on the next page load.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentPolicyHash, FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import {
  captureLegacyChildConsent,
  type KidCredentialsDeps,
} from "@/app/lib/v3-signup/kid-credentials-core";
// The jurisdiction constant the accept path already persists, imported rather
// than re-typed so an accept row and a decline row can never disagree.
import { V3_CONSENT_JURISDICTION } from "@/app/lib/v3-signup/v3-onboarding-core";
import {
  ageBandForGrade,
  childHasQualifyingConsent,
  parentOwesConsentDecision,
  type ConsentWallChildFacts,
} from "@/app/lib/funnel/consent-wall-rules";

/** The app_metadata key stamped when a parent explicitly DECLINES at the wall.
 *  Additive and non-destructive: it records that they were asked and refused,
 *  and it revokes, disables and deletes exactly nothing. */
export const CONSENT_WALL_DECLINED_METADATA_KEY = "fp_consent_wall_declined_at";

/**
 * The `evidence.source` the rows this module writes carry. NOT a value this
 * module chooses: it is what `captureLegacyChildConsent` stamps, and the writer
 * is REUSED rather than forked, so the wall's rows are byte-identical in shape
 * to the per-kid dashboard capture's. Mirrored here only so the dedupe sweep's
 * filter and the writer cannot drift apart silently.
 */
export const CONSENT_WALL_SOURCE = "dashboard_legacy_capture";

/**
 * ── WHY A `revoked_at` STAMP MUST SAY WHY (review 2026-08-10, P1-b) ──
 *
 * `fp_parental_consent` is compliance EVIDENCE that must survive deletion. A
 * bare `revoked_at` cannot tell an auditor whether a parent WITHDREW their
 * consent or whether housekeeping tidied a duplicate away — two facts with
 * opposite legal meanings, written by two different code paths, indistinguishable
 * in the data.
 *
 * So every writer that stamps `revoked_at` also stamps
 * `evidence.revoked_reason`, read-modify-written onto whatever the blob already
 * carries. There is currently exactly ONE such writer in the app — the dedupe
 * sweep below. (The per-child photo withdrawal deliberately no longer revokes
 * rows at all; it marks `photo_declined` instead. See
 * `revokeChildPhotoConsent`'s docblock and `PHOTO_WITHDRAWAL_REASON`.)
 *
 * ⚠ IF YOU ADD A THIRD WRITER OF `revoked_at`, GIVE IT ITS OWN REASON CONSTANT.
 */
export const CONSENT_REVOKED_REASON_DEDUPE = "dedupe_surplus";

/** The `evidence.verdict` a wall DECLINE row carries. Paired with a
 *  non-null `revoked_at` at insert time, it is what makes that row impossible to
 *  mistake for consent. */
export const CONSENT_WALL_DECLINED_VERDICT = "declined";

/** The `evidence.source` a wall DECLINE row carries. Deliberately DIFFERENT from
 *  `CONSENT_WALL_SOURCE`, so the dedupe sweep's `evidence->>source` filter can
 *  never see a decline row and no accept-path query can either. */
export const CONSENT_WALL_DECLINE_SOURCE = "consent_wall";

/** Merge new keys onto a row's existing `evidence`. READ-MODIFY-WRITE, never a
 *  clobber: `evidence` is the legal blob and it only ever accretes. */
function mergeEvidence(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

/* --------------------------------------------------------------- the reads */

/** One roster row the wall needs: the id, and the only age signal a pre-v3 row
 *  carries. */
type WallChildRow = { id: string; grade: number | null };

export type ConsentWallDeps = {
  /** SERVICE-ROLE client, as a FACTORY — nothing privileged is constructed
   *  until the caller has been named (the kid-credentials-core rule). */
  db: () => SupabaseClient;
  now: () => number;
  log: (message: string) => void;
};

export function realConsentWallDeps(): ConsentWallDeps {
  return { db: () => supabaseAdmin(), now: () => Date.now(), log: (m) => console.error(m) };
}

/**
 * This parent's roster, or null when the read failed (which the callers below
 * all read as "clear" — see the fail-open note in the header).
 */
async function loadWallChildren(
  deps: ConsentWallDeps,
  parentId: string
): Promise<WallChildRow[] | null> {
  const res = await deps.db().from("children").select("id, grade").eq("parent_id", parentId);
  if (res.error) {
    deps.log(`[fp/consent-wall] children read failed: ${res.error.message}`);
    return null;
  }
  return ((res.data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: String(r.id),
    grade: typeof r.grade === "number" ? r.grade : null,
  }));
}

/**
 * The ACTIVE (`revoked_at IS NULL`) consent policy versions per child id, for
 * the given ids. Null = the read failed.
 *
 * The `revoked_at IS NULL` filter is applied HERE rather than in the predicate
 * because "active" is a storage fact; the pure module is handed only the live
 * set (see `ConsentWallChildFacts`).
 */
export async function loadActiveConsentVersionsByChild(
  deps: ConsentWallDeps,
  childIds: readonly string[]
): Promise<Map<string, string[]> | null> {
  const byChild = new Map<string, string[]>();
  if (childIds.length === 0) return byChild;
  const res = await deps
    .db()
    .from("fp_parental_consent")
    .select("child_id, policy_version")
    .in("child_id", childIds as string[])
    .is("revoked_at", null);
  if (res.error) {
    deps.log(`[fp/consent-wall] consent read failed: ${res.error.message}`);
    return null;
  }
  for (const r of (res.data as Array<Record<string, unknown>> | null) ?? []) {
    const id = String(r.child_id);
    const list = byChild.get(id) ?? [];
    if (typeof r.policy_version === "string") list.push(r.policy_version);
    byChild.set(id, list);
  }
  return byChild;
}

/** The wall facts for one parent: every child of theirs, with that child's live
 *  consent versions. Null = a read failed (⇒ clear). */
export async function loadConsentWallFacts(
  deps: ConsentWallDeps,
  parentId: string
): Promise<ConsentWallChildFacts[] | null> {
  const kids = await loadWallChildren(deps, parentId);
  if (kids === null) return null;
  const versions = await loadActiveConsentVersionsByChild(
    deps,
    kids.map((k) => k.id)
  );
  if (versions === null) return null;
  return kids.map((k) => ({
    childId: k.id,
    activePolicyVersions: versions.get(k.id) ?? [],
  }));
}

/* ------------------------------------------------------ THE REAL CONTROL */

/**
 * ⚠ THIS — NOT THE PAGE REDIRECTS — IS THE CONSENT WALL.
 *
 * A Server Action is a separately-addressable POST endpoint; no page render
 * stands in front of it (the page-vs-action gating learning, 2026-08-05). The
 * four `/dashboard` redirects are a routing courtesy that stops a parent
 * bouncing off a screen full of controls that would refuse them. `requireConsentClear`
 * is what actually refuses.
 *
 * Returns TRUE when the caller may proceed. Called AFTER the existing session
 * check in each action, never before: an unauthenticated caller must be refused
 * for being unauthenticated, and must not cost a read.
 *
 * FAIL OPEN (see the header). Any read failure, any throw, answers `true`.
 *
 * ⚠ NOT FOR THE TWO HIGHEST-CONSEQUENCE ACTIONS. Minting a child handoff
 * credential and publishing a child's page to the open internet call
 * `consentClearance` and refuse on `"error"` — see that function's docblock.
 */
export async function requireConsentClear(
  parentId: string,
  deps: ConsentWallDeps = realConsentWallDeps()
): Promise<boolean> {
  const verdict = await consentClearance(parentId, deps);
  if (verdict === "error") {
    // LOUDLY, on every single fail-open resolution. A wall that silently stops
    // enforcing during an outage is a wall nobody notices has stopped.
    deps.log(
      `[fp/consent-wall] ⚠ OUTAGE: the consent read did not answer for parent ${parentId} — failing open, this caller is being treated as clear`
    );
    return true;
  }
  return verdict === "clear";
}

/**
 * THE THREE-VALUED ANSWER: `"clear"`, `"owes"`, or `"error"`.
 *
 * ── WHY THE ERROR CASE IS A SEPARATE VALUE (review 2026-08-10, P2-a) ──
 * `requireConsentClear` collapses `"error"` into "clear", and for a page
 * redirect or a password reset that is right: a Postgres hiccup must not
 * blockade a paying family out of their own dashboard. But the SAME collapse
 * applied to `v3MintHandoffAction` (which mints a bearer credential for a
 * child's session) and `setFpSitePublishedAction` (which puts a child's page on
 * the open internet) means an outage silently un-gates the two acts the wall
 * most exists to stop.
 *
 * Those two callers fail CLOSED on `"error"` — the repo's existing precedent,
 * stated in cover-core.ts: AN UNREADABLE TOMBSTONE IS NOT AN ABSENT TOMBSTONE.
 * The cost of failing closed there is a retry; the cost of failing open is
 * irreversible.
 *
 * `"error"` means the READ did not answer. It is never returned for a
 * successfully-read family, however that family's facts come out.
 */
export type ConsentClearance = "clear" | "owes" | "error";

export async function consentClearance(
  parentId: string,
  deps: ConsentWallDeps = realConsentWallDeps()
): Promise<ConsentClearance> {
  try {
    const facts = await loadConsentWallFacts(deps, parentId);
    // null is the loaders' one and only "the read failed" signal.
    if (facts === null) return "error";
    return parentOwesConsentDecision({ children: facts }) ? "owes" : "clear";
  } catch (err) {
    deps.log(
      `[fp/consent-wall] consentClearance threw: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return "error";
  }
}

/* ------------------------------------------------------------- the accept */

export type ConsentWallAcceptOutcome =
  /** Every child that owed one now has a qualifying active consent. `recorded`
   *  is also the answer for a REPLAY that had nothing left to record — an
   *  idempotent endpoint reports success for the state it guarantees, not for
   *  the rows it happened to write this time. */
  | "recorded"
  | "nothing_owed"
  | "outage";

export type ConsentWallCaller = {
  parentId: string;
  parentEmail: string;
  ip: string;
  ua: string;
};

/**
 * Record consent for EVERY child of this parent that lacks one, snapshotting the
 * SERVER's current version / hash / text via `captureLegacyChildConsent` — the
 * existing attempt-less per-CHILD writer, reused rather than forked, so the
 * legal record this wall produces is byte-identical in shape to the one the
 * per-kid dashboard control produces.
 *
 * The echo it is handed is the server's own current version+hash. That is not a
 * loophole in bind-to-rendered: the interstitial renders `FP_CONSENT_POLICY.text`
 * verbatim from this same process, so "what the client rendered" and "what the
 * server currently renders" are the same string by construction — there is no
 * client-side bundle here that could be stale. Handing the writer the client's
 * echoed strings instead would let a replayed POST claim an older version.
 *
 * ── IDEMPOTENCY, ENFORCED IN CODE (the partial unique index does not cover us) ──
 * `fp_parental_consent`'s partial unique index keys on `signup_attempt_id WHERE
 * ... IS NOT NULL`, and every row this path writes has a NULL attempt — so the
 * database will happily accept a duplicate. Three layers, in order:
 *
 *   1. RE-READ IMMEDIATELY BEFORE WRITING. The owing set is computed from a read
 *      taken inside this call, not from anything the client sent, and a child
 *      that already qualifies is skipped. A double-submit whose first half has
 *      committed therefore writes nothing at all on the second.
 *   2. SEQUENTIAL, NOT `Promise.all`. Children are written one at a time so that
 *      two concurrent calls interleave at row granularity rather than firing
 *      2N inserts at once.
 *   3. A POST-WRITE DEDUPE SWEEP. Two genuinely concurrent calls can both read
 *      "owed" before either writes. So after writing, this re-reads each touched
 *      child's live wall-written rows and REVOKES all but the earliest, leaving
 *      exactly one active row per child. That makes "at most one active row per
 *      child" a postcondition of the call rather than a hope about timing.
 *
 * The sweep only ever revokes SURPLUS rows this same wall wrote (matched on
 * `evidence->>source` and a null attempt) and never the one it keeps, so it
 * cannot erase a signup-time or per-kid consent.
 */
export async function recordConsentWallAcceptance(
  kidDeps: KidCredentialsDeps,
  deps: ConsentWallDeps,
  ctx: ConsentWallCaller
): Promise<ConsentWallAcceptOutcome> {
  const kids = await loadWallChildren(deps, ctx.parentId);
  if (kids === null) return "outage";
  if (kids.length === 0) return "nothing_owed";

  const versions = await loadActiveConsentVersionsByChild(
    deps,
    kids.map((k) => k.id)
  );
  if (versions === null) return "outage";

  // Layer 1: the owing set, from THIS call's read.
  const owed = kids.filter(
    (k) =>
      !childHasQualifyingConsent({
        childId: k.id,
        activePolicyVersions: versions.get(k.id) ?? [],
      })
  );
  if (owed.length === 0) return "nothing_owed";

  let failed = false;
  // Layer 2: sequential.
  for (const kid of owed) {
    const outcome = await captureLegacyChildConsent(
      kidDeps,
      {
        childId: kid.id,
        // The SERVER's current version+hash (see the docblock) — the writer
        // re-derives what it actually persists from the same constants.
        echoedVersion: FP_CONSENT_POLICY.version,
        echoedHash: currentPolicyHash(),
        childAgeBand: ageBandForGrade(kid.grade),
        // SERVER-DERIVED identity, never the request body — this is a legal
        // evidence record (recordConsent's own rule, same reason).
        parentEmail: ctx.parentEmail,
        ip: ctx.ip,
        ua: ctx.ua,
      },
      { parentId: ctx.parentId }
    );
    if (outcome !== "recorded") {
      failed = true;
      deps.log(`[fp/consent-wall] capture for child ${kid.id} returned ${outcome}`);
    }
  }

  // Layer 3: the dedupe sweep, whatever happened above.
  await dedupeWallRows(
    deps,
    ctx.parentId,
    owed.map((k) => k.id)
  );

  return failed ? "outage" : "recorded";
}

/**
 * Leave AT MOST ONE active wall-written consent row per child: keep the earliest
 * `accepted_at` (id as the tiebreak, so two rows stamped in the same millisecond
 * still resolve deterministically) and stamp `revoked_at` on the rest.
 *
 * ── THE SCOPE IS FIVE PREDICATES, AND EVERY ONE OF THEM IS LOAD-BEARING ──
 *   - `parent_id`   — the session-derived caller, never a request value.
 *   - `child_id IN` — only the children THIS call just wrote for.
 *   - `signup_attempt_id IS NULL` — a signup-time consent can never be swept.
 *   - `policy_version = FP_CONSENT_POLICY.version` — ⚠ this one is the subtle
 *     one. Every child in the owed set is owed precisely because it had no
 *     ACTIVE row reaching the anchor; but it may still hold an active row at a
 *     BELOW-ANCHOR version. Without this predicate that ancient row would sort
 *     EARLIEST, be "kept", and our brand-new valid consent would be revoked as
 *     the duplicate — the exact inversion of the intent. Restricting the sweep
 *     to rows at the current version means only rows this call (or a call
 *     racing it) could have written are ever candidates.
 *   - plus `evidence->>source`, which excludes any future writer that is not
 *     this reused legacy-capture path.
 *
 * Best-effort by design — a failure here leaves a harmless duplicate
 * affirmation, which every downstream gate (all EXISTS-shaped) reads
 * identically to one.
 */
async function dedupeWallRows(
  deps: ConsentWallDeps,
  parentId: string,
  childIds: readonly string[]
): Promise<void> {
  if (childIds.length === 0) return;
  const res = await deps
    .db()
    .from("fp_parental_consent")
    // `evidence` rides along so the reason stamp below is a READ-MODIFY-WRITE
    // rather than a clobber of the legal blob (review 2026-08-10, P1-b).
    .select("id, child_id, accepted_at, evidence")
    .eq("parent_id", parentId)
    .in("child_id", childIds as string[])
    .is("revoked_at", null)
    .is("signup_attempt_id", null)
    .eq("policy_version", FP_CONSENT_POLICY.version)
    .eq("evidence->>source", CONSENT_WALL_SOURCE);
  if (res.error) {
    deps.log(`[fp/consent-wall] dedupe read failed: ${res.error.message}`);
    return;
  }
  const rows = ((res.data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: String(r.id),
    childId: String(r.child_id),
    acceptedAt: typeof r.accepted_at === "string" ? Date.parse(r.accepted_at) : NaN,
    evidence: r.evidence,
  }));
  const byChild = new Map<string, typeof rows>();
  for (const r of rows) byChild.set(r.childId, [...(byChild.get(r.childId) ?? []), r]);

  const surplus: typeof rows = [];
  for (const list of byChild.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const at = Number.isFinite(a.acceptedAt) ? a.acceptedAt : Number.POSITIVE_INFINITY;
      const bt = Number.isFinite(b.acceptedAt) ? b.acceptedAt : Number.POSITIVE_INFINITY;
      return at === bt ? a.id.localeCompare(b.id) : at - bt;
    });
    // Keep sorted[0]; everything after it is the duplicate.
    surplus.push(...sorted.slice(1));
  }
  if (surplus.length === 0) return;

  const stamp = new Date(deps.now()).toISOString();
  // ROW BY ROW, not one `.in()` update, because each row's `evidence` must be
  // read-modify-written rather than clobbered (review 2026-08-10, P1-b). The
  // surplus set is a handful of rows by construction — this loop only ever runs
  // when two concurrent accepts raced.
  for (const row of surplus) {
    const swept = await deps
      .db()
      .from("fp_parental_consent")
      .update({
        revoked_at: stamp,
        evidence: mergeEvidence(row.evidence, {
          revoked_reason: CONSENT_REVOKED_REASON_DEDUPE,
          revoked_at_stamped: stamp,
        }),
      })
      .eq("parent_id", parentId)
      .eq("id", row.id);
    if (swept.error) {
      deps.log(`[fp/consent-wall] dedupe sweep failed for row ${row.id}: ${swept.error.message}`);
    }
  }
}

/* ------------------------------------------------------------ the decline */

export type ConsentWallDeclineOutcome = "recorded" | "outage";

/**
 * Record that this parent was ASKED and REFUSED.
 *
 * ⚠ STRICTLY NON-DESTRUCTIVE, AND THAT IS THE WHOLE DESIGN. It deletes nothing,
 * disables nothing, revokes nothing, signs nobody out, and takes no page
 * offline. A decline is the beginning of a CONVERSATION, not an enforcement
 * action: the families this wall exists for have children mid-way through a
 * course, and a parent who wants to think about it, or who misreads a button on
 * a phone, must not be able to destroy their kid's work with one tap. Whatever
 * offboarding a genuine refusal calls for is a human decision made off this
 * screen — which is exactly why the wall's decline copy says to contact The 120.
 *
 * THE RECORD IS TWO THINGS, AND BOTH ARE ADDITIVE:
 *
 *   1. An app_metadata stamp on the parent's own auth user (the
 *      `password_chosen` idiom): a MERGE, so no existing metadata is dropped.
 *      It is the FAST PATH — one field on a user object we already load.
 *   2. A first-class, QUERYABLE row in `fp_parental_consent` (review
 *      2026-08-10, P1-c). Without it the only way to answer "which parents
 *      refused, and when" is to walk the Auth Admin API user by user, and the
 *      refusal is invisible to every export and audit query we have. See
 *      `insertDeclineRows`.
 *
 * The parent stays on the wall afterwards, because they still owe a decision —
 * declining is not consenting, and the predicate is unmoved by either record.
 */
export async function recordConsentWallDecline(
  deps: ConsentWallDeps,
  setAppMetadata: (userId: string, patch: Record<string, unknown>) => Promise<{ ok: boolean }>,
  ctx: { parentId: string }
): Promise<ConsentWallDeclineOutcome> {
  const stamp = new Date(deps.now()).toISOString();
  const res = await setAppMetadata(ctx.parentId, {
    [CONSENT_WALL_DECLINED_METADATA_KEY]: stamp,
  });
  if (!res.ok) {
    deps.log(`[fp/consent-wall] decline stamp failed for parent ${ctx.parentId}`);
    return "outage";
  }
  // BEST EFFORT, and deliberately AFTER the authoritative stamp: a parent's
  // refusal is recorded the moment the metadata lands, and a failed audit
  // insert must not report the refusal as un-taken (which would leave them
  // tapping the button again). It is logged loudly instead.
  await insertDeclineRows(deps, ctx.parentId, stamp);
  deps.log(`[fp/consent-wall] parent ${ctx.parentId} DECLINED at ${stamp} (nothing was changed)`);
  return "recorded";
}

/**
 * THE DECLINE, AS A ROW THAT CAN NEVER BE MISTAKEN FOR CONSENT.
 *
 * One row per child of this parent — per child, because consent in this table is
 * per child and a family-level row would have a NULL `child_id` that no
 * child-keyed query would ever surface.
 *
 * ── THE THREE THINGS THAT MAKE IT UNMISTAKABLE ──
 *   1. `revoked_at` IS SET AT INSERT TIME, to the same instant as `accepted_at`.
 *      Every gate in this app that looks for consent is EXISTS-shaped over
 *      `revoked_at IS NULL` — the wall's own loader, the photo verdict, the mint
 *      gate. A born-revoked row is invisible to all of them, structurally,
 *      without a single one of them needing to learn about declines.
 *   2. `evidence.verdict = "declined"` and `evidence.source = "consent_wall"`.
 *      The source is deliberately NOT `CONSENT_WALL_SOURCE`, so the accept
 *      path's dedupe sweep (which filters on `evidence->>source`) cannot see it
 *      either.
 *   3. `policy_hash` / `rendered_text` snapshot WHAT WAS REFUSED. The row is
 *      evidence of a refusal of a specific text, which is the only thing that
 *      makes a refusal meaningful later.
 *
 * Every NOT NULL column of the table is supplied: `policy_namespace`,
 * `policy_version`, `policy_hash`, `rendered_text`, `method`, `jurisdiction`,
 * `parent_identity`, `ip`, `ua`, `evidence`, `accepted_at`. `child_age_band` is
 * nullable (its CHECK admits NULL) but is filled anyway, conservatively, from
 * the same `ageBandForGrade` the accept path uses.
 *
 * ⚠ `accepted_at` IS NOT AN ACCEPTANCE. The column is the table's only timestamp
 * for "when this decision was made"; the `verdict` key and the born-revoked
 * stamp are what say which decision it was.
 */
async function insertDeclineRows(
  deps: ConsentWallDeps,
  parentId: string,
  stamp: string
): Promise<void> {
  const kids = await loadWallChildren(deps, parentId);
  if (kids === null) {
    deps.log(
      `[fp/consent-wall] ⚠ decline for parent ${parentId} recorded in app_metadata but NOT as a queryable row: the roster read failed`
    );
    return;
  }
  if (kids.length === 0) return;

  const rows = kids.map((kid) => ({
    signup_attempt_id: null,
    parent_id: parentId,
    child_id: kid.id,
    policy_namespace: "fp_parental_consent",
    policy_version: FP_CONSENT_POLICY.version,
    policy_hash: currentPolicyHash(),
    rendered_text: FP_CONSENT_POLICY.text,
    method: "email_plus_attestation",
    child_age_band: ageBandForGrade(kid.grade),
    jurisdiction: V3_CONSENT_JURISDICTION,
    parent_identity: {},
    ip: "",
    ua: "",
    evidence: {
      source: CONSENT_WALL_DECLINE_SOURCE,
      verdict: CONSENT_WALL_DECLINED_VERDICT,
      declined_at: stamp,
    },
    accepted_at: stamp,
    // BORN REVOKED — see the docblock. This is the whole safety property.
    revoked_at: stamp,
  }));

  const inserted = await deps.db().from("fp_parental_consent").insert(rows);
  if (inserted.error) {
    deps.log(
      `[fp/consent-wall] ⚠ decline for parent ${parentId} recorded in app_metadata but NOT as a queryable row: ${inserted.error.message}`
    );
  }
}

/* ------------------------------------------------------------ the session */

/** The session-derived caller, read from the verified JWT. Null = no session. */
export async function consentWallCallerFromSession(): Promise<{
  parentId: string;
  parentEmail: string;
} | null> {
  const supabase = await supabaseServer();
  // getUser() verifies the JWT with the auth server; getSession() alone would
  // trust a cookie this process never validated.
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user?.id) return null;
  return { parentId: user.id, parentEmail: user.email ?? "" };
}
