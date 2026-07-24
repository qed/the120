/**
 * FW guide identity core (FW Unit 2) — the db-taking half of the guide door:
 * the authorization inputs a caller needs to resolve an FW actor, and the three
 * credentialing sequences (provision, issue/re-issue, claim).
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so a future ops script can reuse it under tsx). Callers
 * own their gate: `fw-auth.ts` gates the pages, the FW actions gate with the
 * staff bridge. See docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-… and …/use-server-type-reexport-registers-server-
 * reference-…
 *
 * Sibling of `provision-core.ts`'s FW half in posture: every decision that could
 * be wrong lives in `fw-access-rules.ts`; this file adds I/O, sequencing, and
 * compensation, and is tested with the same fake-Supabase-client harness (Unit
 * 1's review found the untested orchestration was its biggest gap).
 *
 * COMPENSABLE, per docs/solutions/best-practices/no-transaction-multi-step-write-
 * compensation-post-write-verify-cas-scoped-claim-2026-07-22.md — nothing here
 * spans the Auth API and PostgREST in a transaction, so each sequence names what
 * it undoes on failure.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  buildFwGuideCreateUserPayload,
  fwGuideInviteExpiry,
  fwGuideInviteVerdict,
  isGuideAccount,
  FW_COHORT_KIND,
  type FwCohortLike,
} from "./fw-access-rules";
import { normalizeEmail } from "./onboarding-rules";
import { recordFwOpsAudit } from "./fw-audit-core";
import { fwRead, fwWrite } from "./fw-call";
import { validateStudentPassword } from "./provision-rules";
import { findAuthUserByEmail } from "./provision-core";

/** SHA-256 hex — the ONLY form a guide invite token is ever stored in. */
export function hashGuideInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* ────────────────────────────────────────────── authorization inputs (reads) ── */

/**
 * Load the cohort `resolveFwActor` will judge — AUTHORITATIVELY, which is the
 * whole reason this is a database read and not a parameter. `kind` decides
 * whether the bridge applies and whether a board token may ever be minted, so a
 * client-supplied kind would make the bridge self-service.
 *
 * A read error returns null (fail closed) after logging: "the cohort could not
 * be loaded" and "there is no such cohort" both mean nobody is authorized, and
 * conflating them here is safe because neither is an authorization grant.
 */
export async function loadFwCohort(
  db: SupabaseClient,
  cohortId: string
): Promise<FwCohortLike> {
  const res = await db
    .from("path_cohorts")
    .select("id, kind, slug")
    .eq("id", cohortId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] cohort load failed for ${cohortId}: ${res.error.message}`);
    return null;
  }
  // Fail-closed narrowing at the service-role boundary (the parseCandidateRow
  // discipline): `db` is untyped, so an `as string` here would be a promise to
  // the compiler with nothing behind it — and this value gates a write path.
  const row = res.data;
  if (!row || typeof row.id !== "string" || typeof row.kind !== "string") return null;
  return { id: row.id, kind: row.kind };
}

/**
 * The bridge's second input: is there a LIVE, ACTIVE staff row for this user?
 * Read fresh on every resolution — never from the JWT — because revocation is
 * exactly what the stale-JWT rule exists to catch (`resolveStaffAccess`'s
 * `is_active` branch, inherited wholesale).
 *
 * A read error returns false: an outage must not promote anyone to staff.
 */
export async function loadStaffRowActive(
  db: SupabaseClient,
  userId: string
): Promise<boolean> {
  const res = await db
    .from("staff")
    .select("id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] staff row load failed for ${userId}: ${res.error.message}`);
    return false;
  }
  return res.data?.is_active === true;
}

export type FwCohortSummary = { id: string; slug: string };

/**
 * Every `kind='fw'` cohort this actor may act in — the roster behind the cohort
 * switcher (Decision 3) and the stub surface's proof that the bridge works.
 *
 * Staff (bridge) see every fw cohort; a pure guide sees only the ones their
 * grants name. Filtering happens in SQL for staff and by id-set for guides, but
 * BOTH paths re-read `kind` from the cohort rows rather than trusting the grant:
 * a `guide`/`cohort` grant can name a Path cohort (that is the Path's own D25
 * reviewer grant) and must not surface here.
 *
 * TRI-STATE ON PURPOSE (reliability review). `loadFwCohort` and
 * `loadStaffRowActive` collapse a read failure into "no" because that is an
 * AUTHORIZATION fail-closed rule — an outage must never grant access. This
 * function runs AFTER the caller is already authorized, so the same collapse
 * would buy no safety and cost a lie: an empty array is indistinguishable from
 * "you hold no grants", and the landing page renders exactly that copy. A guide
 * hitting a DB blip at the start of an event-morning shift would be told to go
 * find staff over something a refresh fixes. So the failure is reported.
 */
export async function listFwCohortsForActor(
  db: SupabaseClient,
  input: { grantedCohortIds: readonly string[]; isStaff: boolean }
): Promise<{ ok: true; cohorts: FwCohortSummary[] } | { ok: false }> {
  if (!input.isStaff && input.grantedCohortIds.length === 0) return { ok: true, cohorts: [] };

  let query = db.from("path_cohorts").select("id, slug, kind").eq("kind", FW_COHORT_KIND);
  if (!input.isStaff) {
    query = query.in("id", [...input.grantedCohortIds]);
  }
  const res = await query;
  if (res.error) {
    console.error(`[fw/guide] cohort list failed: ${res.error.message}`);
    return { ok: false };
  }
  return {
    ok: true,
    cohorts: (res.data ?? [])
      .filter(
        (r): r is { id: string; slug: string; kind: string } =>
          typeof r.id === "string" && typeof r.slug === "string" && r.kind === FW_COHORT_KIND
      )
      .map((r) => ({ id: r.id, slug: r.slug })),
  };
}

/* ───────────────────────────────────────────────────── guide provisioning ──── */

export type ProvisionFwGuideInput = {
  email: string;
  /** Must be a `kind='fw'` cohort — verified here, not assumed. */
  cohortId: string;
  /** The staff user performing this. Recorded on the invite row. */
  createdBy: string;
};

export type ProvisionFwGuideFailure =
  | "invalid_email"
  | "cohort_not_found"
  | "cohort_not_fw"
  /** The address already belongs to an account this system did not mint as a
   *  guide (staff, parent, student). Never adopted — see canAdoptAsGuideAccount. */
  | "address_in_use"
  | "unavailable";

export type ProvisionFwGuideResult =
  | {
      ok: true;
      userId: string;
      email: string;
      created: boolean;
      /** Whether THIS call actually inserted the grant row. False on a re-run
       *  for a cohort the guide already holds — which is the common case, since
       *  the whole function is idempotent by design. */
      grantAdded: boolean;
      /** Whether the liability record for that insert landed. Always true when
       *  `grantAdded` is false (there was nothing to record). Reported so the
       *  ops copy can say "added — but the audit record didn't save" rather
       *  than losing it quietly. */
      audited: boolean;
    }
  | { ok: false; reason: ProvisionFwGuideFailure };

/**
 * Mint (or adopt) one guide account and grant it into an fw cohort.
 *
 * Sequence: verify cohort → mint dormant account → `guide`/`cohort` grant.
 * The account carries NO admin claim and NO password (FW-R5, Decision 12); the
 * invite claim is what sets a credential.
 *
 * Idempotent by design, because staff will re-run it: an `email_exists` on
 * createUser adopts the existing account IF AND ONLY IF it is already a guide
 * account, and the grant upsert ignores duplicates. Adding a second cohort's
 * grant to an existing guide is therefore just calling this again — which is
 * what "a guide works Boston and Hamptons" means.
 *
 * Compensation: an account THIS call minted is best-effort deleted when the
 * grant write fails, so a retry does not meet an orphan account with no grant
 * (the invite.ts reliability precedent). An ADOPTED account is never deleted —
 * it predates this call and may hold other cohorts' grants.
 */
export async function provisionFwGuide(
  db: SupabaseClient,
  input: ProvisionFwGuideInput
): Promise<ProvisionFwGuideResult> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }

  const cohort = await loadFwCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };

  let payload;
  try {
    payload = buildFwGuideCreateUserPayload({ email });
  } catch {
    // The one throwing case is the FW student namespace — a typo that would put
    // a password-carrying account inside the dormant minors' namespace.
    return { ok: false, reason: "invalid_email" };
  }

  let user: User;
  let created = false;
  const attempt = await db.auth.admin.createUser(payload);
  if (attempt.error || !attempt.data?.user) {
    const emailExists =
      attempt.error?.code === "email_exists" ||
      /already.*(registered|exists)/i.test(attempt.error?.message ?? "");
    if (!emailExists) {
      console.error(
        `[fw/guide] createUser failed for ${email} (cohort ${input.cohortId}): ${attempt.error?.message ?? "no user returned"}`
      );
      return { ok: false, reason: "unavailable" };
    }
    const found = await findAuthUserByEmail(db, email);
    if (!found) {
      console.error(`[fw/guide] createUser said email_exists but no user found for ${email}`);
      return { ok: false, reason: "unavailable" };
    }
    // The escalation guard: an invite issued against this account can SET ITS
    // PASSWORD. Adopting a staff/parent/student account would turn "add a guide"
    // into "mail a credential for that person's account to whoever staff typed".
    if (!isGuideAccount(found)) {
      console.error(
        `[fw/guide] refusing to adopt non-guide account for ${email} (role=${String(found.app_metadata?.role)})`
      );
      return { ok: false, reason: "address_in_use" };
    }
    user = found;
  } else {
    user = attempt.data.user;
    created = true;
  }

  // `.select("id")` is not cosmetic: with `ignoreDuplicates` this is
  // `ON CONFLICT DO NOTHING`, so the RETURNING set is exactly the rows that were
  // genuinely inserted — the only honest signal for "did a human just gain
  // check-in power here?", which is what the audit row claims. Without it the
  // idempotent re-run (adding a guide to a second weekend, or staff double-
  // submitting) would write a `guide_grant_added` record for a grant that
  // already existed, and an audit log with invented events is worse than none.
  const grant = await fwWrite(
    () =>
      db
        .from("path_role_grants")
        .upsert([{ user_id: user.id, role: "guide", scope_type: "cohort", scope_id: cohort.id }], {
          onConflict: "user_id,role,scope_type,scope_id",
          ignoreDuplicates: true,
        })
        .select("id"),
    `guide grant upsert (${user.id}/${cohort.id})`
  );
  if (grant.error) {
    console.error(
      `[fw/guide] grant upsert failed for ${user.id}/${cohort.id}: ${grant.error.message}`
    );

    // POST-WRITE VERIFY BEFORE ANYTHING ELSE (adversarial review). A reported
    // failure does not mean nothing happened — `fwWrite` says so explicitly, and
    // over venue wifi a committed insert whose response was lost is the likely
    // shape. Returning straight out would leave a guide holding REAL check-in
    // power with no `guide_grant_added` row, and the retry makes that permanent
    // AND invisible: the second attempt's ON CONFLICT DO NOTHING correctly
    // reports "already there" (grantAdded=false, audited=true trivially) and the
    // UI shows a completely ordinary success. The liability record would simply
    // never exist for a grant nobody can now explain.
    const landed = await fwRead(
      () =>
        db
          .from("path_role_grants")
          .select("id")
          .eq("user_id", user.id)
          .eq("role", "guide")
          .eq("scope_type", "cohort")
          .eq("scope_id", cohort.id)
          .maybeSingle(),
      `guide grant verify (${user.id}/${cohort.id})`
    );
    if (!landed.error && landed.data) {
      console.warn(
        `[fw/guide] grant upsert for ${user.id}/${cohort.id} reported an error but LANDED — auditing it`
      );
      const auditedAnyway = await recordFwOpsAudit(db, {
        actor: input.createdBy,
        action: "guide_grant_added",
        subjectUserId: user.id,
        cohortId: cohort.id,
        metadata: { email, accountCreated: created, recoveredFromReportedFailure: true },
      });
      return {
        ok: true,
        userId: user.id,
        email: user.email ?? email,
        created,
        grantAdded: true,
        audited: auditedAnyway,
      };
    }

    if (created) {
      // `created` says THIS call minted the account, which is necessary but no
      // longer sufficient (adversarial review): two staff double-submitting the
      // same new guide into two cohorts race, the loser ADOPTS the winner's
      // account, and if the winner's grant write then fails it would delete an
      // account the loser is mid-way through granting — leaving the loser's
      // insert to fail on a vanished FK and BOTH staff staring at an error for
      // what looked like one successful mint. Re-probe first: any grant row
      // means the account is no longer solely ours to withdraw.
      const referenced = await db
        .from("path_role_grants")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (referenced.error) {
        // Cannot prove the account is unreferenced — leave it. An orphan account
        // is recoverable (the next provisioning run adopts it); deleting one
        // another caller is using is not.
        console.error(
          `[fw/guide] compensation probe failed for ${user.id}: ${referenced.error.message} — leaving the account in place`
        );
      } else if (referenced.data) {
        console.warn(
          `[fw/guide] skipping compensation for ${user.id}: a concurrent caller already granted it`
        );
      } else {
        const del = await db.auth.admin.deleteUser(user.id);
        if (del.error) {
          // Deliberately NOT "the account is grant-less" (round-2 adversarial
          // review): the probe and this delete are separate requests, so a
          // concurrent grant can land between them — and if it did, THIS error
          // is most likely `path_role_grants`' ON DELETE RESTRICT refusing, i.e.
          // evidence a grant now exists. Asserting grant-less here would invite
          // an operator to hand-delete an account that is genuinely in use.
          console.error(
            `[fw/guide] compensation deleteUser failed for ${user.id}: ${del.error.message} — a concurrent grant may now reference it; verify before any manual cleanup`
          );
        }
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  // THE AUDIT WRITE LIVES HERE, INSIDE THE MUTATION, and that placement is the
  // point. This function is the ONLY writer of `guide`/`cohort` grants in the
  // repo (the other `path_role_grants` writers issue `parent`/`student` grants),
  // and it already has three call sites: the staff provisioning action, the ops
  // surface, and `scripts/seed-fw-guide.ts`. An audit written at any one of them
  // is an audit the other two bypass — the exact family of bug documented three
  // times this month in docs/solutions/logic-errors/confirmation-gate-in-one-
  // entry-point-bypassed-by-retry-paths-….
  const grantAdded = (grant.data ?? []).length > 0;
  const audited = grantAdded
    ? await recordFwOpsAudit(db, {
        actor: input.createdBy,
        action: "guide_grant_added",
        subjectUserId: user.id,
        cohortId: cohort.id,
        metadata: { email, accountCreated: created },
      })
    : true;

  return { ok: true, userId: user.id, email: user.email ?? email, created, grantAdded, audited };
}

/* ──────────────────────────────────────────────────── invite issue / re-issue ── */

/**
 * Why issuance has two modes (correctness + adversarial review, merged P1).
 *
 * `provisionFwGuide` is deliberately idempotent so that "a guide works Boston
 * AND Hamptons" is just calling it again with the second cohort id. Issuing
 * unconditionally after every successful provision turned that documented,
 * intended flow into a credential rotation: an already-claimed guide being added
 * to a second weekend had their invite row reset to unclaimed, their token
 * rotated, and a fresh 14-day "choose a password" link mailed to them —
 * corrupting the pre-event "all guides claimed" checklist (the very thing the
 * table's partial index exists to serve) and putting a live password-setting
 * link in the inbox of someone who, mid-event on a shared iPad, might well click
 * it and silently overwrite the password they are actively working with.
 *
 *   "ensure"  — provisioning. Give a guide a credential only if they do not
 *               already have one. Never touches a claimed invite.
 *   "reissue" — staff recovery (Decision 12). Rotate unconditionally and re-open
 *               the claim. This is the deliberate, rare action; it stays
 *               deliberate by being reachable only from its own staff action.
 */
export type IssueFwGuideInviteMode = "ensure" | "reissue";

export type IssueFwGuideInviteResult =
  /** A fresh token was minted and must be mailed. */
  | { ok: true; issued: true; token: string; email: string; expiresAt: string }
  /** "ensure" mode found a live claimed credential and deliberately left it
   *  alone. Nothing to mail; the guide already has a password. */
  | { ok: false; reason: "guide_not_found" | "not_a_guide_account" | "unavailable" }
  | { ok: true; issued: false; email: string };

/**
 * Issue — or RE-issue — the tokened link a guide sets their password with.
 *
 * One row per guide account (`user_id` is unique), rotated in place. That is
 * what makes "a re-issue kills the old hash" structurally true rather than a
 * discipline: there is nowhere for a second live token to exist. A re-issue also
 * RESETS `claimed_at` to null, which is the sanctioned Friday-morning recovery
 * for a guide who forgot the password they set (Decision 12) — the guide door
 * has no email-based reset, and it must not grow one (FW addresses are guessable
 * and the two existing reset forms call Supabase from the browser, where no
 * server-side guard can reach them).
 *
 * Re-verifies the target is a guide account before minting. Without that, an
 * account whose role changed after provisioning (or an id typed by hand into an
 * ops form) could be handed a password-setting link.
 */
export async function issueFwGuideInvite(
  db: SupabaseClient,
  input: {
    userId: string;
    createdBy: string;
    now: number;
    /** Defaults to "reissue" — the explicit staff action's semantics. */
    mode?: IssueFwGuideInviteMode;
  }
): Promise<IssueFwGuideInviteResult> {
  const mode = input.mode ?? "reissue";

  const account = await db.auth.admin.getUserById(input.userId);
  // An Admin API FAILURE is not the same fact as "no such account", and
  // conflating them tells staff the guide's account is broken (sending them to
  // the roster) when the truthful answer is "retry" (reliability review). The
  // FK is `on delete restrict`, so a live invite row pointing at a genuinely
  // deleted account is close to structurally impossible — which is exactly why
  // an error here is almost always the call, not the account.
  if (account.error) {
    console.error(
      `[fw/guide] invite target lookup failed for ${input.userId}: ${account.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  if (!account.data?.user) {
    console.error(`[fw/guide] invite target ${input.userId} does not exist`);
    return { ok: false, reason: "guide_not_found" };
  }
  const user = account.data.user;
  if (!isGuideAccount(user)) {
    console.error(
      `[fw/guide] refusing to issue an invite for a non-guide account ${input.userId} (role=${String(user.app_metadata?.role)})`
    );
    return { ok: false, reason: "not_a_guide_account" };
  }
  const email = normalizeEmail(user.email ?? "");
  if (email.length === 0) {
    console.error(`[fw/guide] guide account ${input.userId} has no email`);
    return { ok: false, reason: "unavailable" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = fwGuideInviteExpiry(input.now);
  const issuedAt = new Date(input.now).toISOString();
  const row = {
    user_id: input.userId,
    email,
    token_hash: hashGuideInviteToken(token),
    expires_at: expiresAt,
    // Re-open the claim. Correct for "reissue" — that is the whole point of the
    // recovery path — and gated behind the claimed-check below for "ensure".
    claimed_at: null,
    issued_at: issuedAt,
    created_by: input.createdBy,
  };

  if (mode === "ensure") {
    const existing = await db
      .from("path_fw_guide_invites")
      .select("id, claimed_at, expires_at")
      .eq("user_id", input.userId)
      .maybeSingle();
    if (existing.error) {
      console.error(
        `[fw/guide] invite probe failed for ${input.userId}: ${existing.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
    if (existing.data) {
      // "Do they already have a usable credential?" — decided by the SAME pure
      // verdict the claim page and the claim action use, so the three can never
      // disagree about what "live" means.
      //
      // A LIVE UNCLAIMED invite counts as having one (round-2 adversarial
      // review). Rotating it would reproduce a narrower version of the very bug
      // this mode exists to prevent: an unclaimed link is one a guide may be
      // opening right now, and rotating mid-claim makes their CAS miss on the
      // old hash, hands them the dead-link message, CHARGES them a rate-limit
      // strike for a legitimate attempt, and quietly mails a replacement they
      // have no reason to look for. Only a genuinely dead invite is refreshed.
      const existingVerdict = fwGuideInviteVerdict({
        invite:
          typeof existing.data.expires_at === "string"
            ? {
                expiresAt: existing.data.expires_at,
                claimedAt:
                  typeof existing.data.claimed_at === "string" ? existing.data.claimed_at : null,
              }
            : null,
        now: input.now,
      });
      if (existingVerdict.ok || existingVerdict.reason === "already_claimed") {
        return { ok: true, issued: false, email };
      }
      // Expired (or a malformed row, which `not_found` covers) — the guide has
      // no usable credential, so minting one is exactly what "ensure" is for.
      // Still CAS on `claimed_at is null`: a claim landing between the probe and
      // this write must not be silently un-claimed. Zero rows means the guide
      // just credentialed themselves and we must not rotate on top of them.
      const refreshed = await db
        .from("path_fw_guide_invites")
        .update(row)
        .eq("user_id", input.userId)
        .is("claimed_at", null)
        .select("id");
      if (refreshed.error) {
        console.error(
          `[fw/guide] invite refresh failed for ${input.userId}: ${refreshed.error.message}`
        );
        return { ok: false, reason: "unavailable" };
      }
      if ((refreshed.data ?? []).length === 0) {
        return { ok: true, issued: false, email };
      }
      return { ok: true, issued: true, token, email, expiresAt };
    }
    // No row yet — fall through to the insert-or-update below.
  }

  // "reissue" rotates with NO precondition — that is the recovery path's whole
  // point, and it must work on a claimed invite. The accepted consequence
  // (round-2 adversarial review): a reissue landing in the gap between a claim's
  // CAS win and its password write leaves the row reading unclaimed even though
  // the guide is credentialed and working. Logged rather than prevented, because
  // preventing it would break the case the action exists for — but a silent
  // version of this is what makes the "all guides claimed" checklist lie, so it
  // is made observable.
  const priorClaim = await db
    .from("path_fw_guide_invites")
    .select("claimed_at")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!priorClaim.error && typeof priorClaim.data?.claimed_at === "string") {
    console.warn(
      `[fw/guide] reissue re-opening an ALREADY-CLAIMED invite for ${input.userId} (claimed ${priorClaim.data.claimed_at}) — the guide's existing password stays valid until they use the new link`
    );
  }

  const upserted = await db
    .from("path_fw_guide_invites")
    .upsert([row], { onConflict: "user_id" });
  if (upserted.error) {
    console.error(`[fw/guide] invite upsert failed for ${input.userId}: ${upserted.error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, issued: true, token, email, expiresAt };
}

/* ────────────────────────────────────────────────────────────── invite claim ── */

export type ClaimFwGuideInviteResult =
  | { ok: true; userId: string; email: string }
  | {
      ok: false;
      reason:
        /** Every dead-link shape collapses here — the caller renders ONE message
         *  so an unauthenticated claimer learns nothing about which it was. */
        | "dead_link"
        | "weak_password"
        /** The CAS was won but the password write failed; the claim was rolled
         *  back so the link the guide is holding still works. */
        | "unavailable";
      message?: string;
    };

/**
 * Claim a guide invite: set the account's first password and burn the token.
 *
 * ORDER IS THE POINT. The CAS claim runs BEFORE the password write:
 *
 *   1. load by hash, judge with the pure verdict (existence → single-use →
 *      expiry, fail-closed on a malformed timestamp);
 *   2. re-verify the target is still a guide account (a role change or a
 *      hand-edited row must not become a password-setting link);
 *   3. validate the password against the shared floor BEFORE burning anything —
 *      a rejected password must not cost the guide their link;
 *   4. CAS: claim the row on (id, THIS token hash, unclaimed). Cardinality picks
 *      the winner of two simultaneous claims, and a staff re-issue mid-flight
 *      rotates the hash so the in-flight claim affects zero rows — the old link
 *      genuinely dies (the invite.ts token-hash CAS precedent);
 *   5. only then set the password.
 *
 * Doing 5 before 4 would let the loser of a race change the password of an
 * account the winner just credentialed. Doing 4 before 5 has one failure mode —
 * a won claim whose password write fails — and it is COMPENSATED: the claim is
 * released (CAS'd back to null on the same hash, so a concurrent re-issue is not
 * clobbered), because the guide is still holding a link that should still work.
 *
 * Signing in is the CALLER's job: the cookie-bound client lives in the action.
 */
export async function claimFwGuideInvite(
  db: SupabaseClient,
  input: { token: string; password: string; now: number }
): Promise<ClaimFwGuideInviteResult> {
  const tokenHash = hashGuideInviteToken(input.token);

  const res = await db
    .from("path_fw_guide_invites")
    .select("id, user_id, email, expires_at, claimed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (res.error) {
    console.error(`[fw/guide] claim load failed: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  const row = res.data;

  const verdict = fwGuideInviteVerdict({
    invite:
      row && typeof row.expires_at === "string"
        ? {
            expiresAt: row.expires_at,
            claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
          }
        : null,
    now: input.now,
  });
  if (!verdict.ok) return { ok: false, reason: "dead_link" };

  // Past a passing verdict the row is non-null; narrow fail-closed anyway — this
  // is the service-role boundary and the next steps write a credential.
  const inviteId = row?.id;
  const userId = row?.user_id;
  if (typeof inviteId !== "string" || typeof userId !== "string") {
    console.error("[fw/guide] claim row has a malformed id/user_id");
    return { ok: false, reason: "unavailable" };
  }

  const account = await db.auth.admin.getUserById(userId);
  // An Admin API FAILURE must not read as a dead link (reliability review, P1).
  // `user_id ... references auth.users on delete restrict` makes a live invite
  // pointing at a deleted account close to structurally impossible, so an error
  // here is almost always the CALL failing — a venue-wifi blip during the
  // Friday-morning claim rush. Reporting `dead_link` would tell a guide their
  // brand-new link is dead AND keep their rate-limit strike (only `unavailable`
  // and `weak_password` release it), eating one of ten shared per-IP attempts.
  if (account.error) {
    console.error(`[fw/guide] claim target lookup failed for ${userId}: ${account.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if (!account.data?.user) {
    console.error(`[fw/guide] claim target ${userId} does not exist`);
    return { ok: false, reason: "dead_link" };
  }
  if (!isGuideAccount(account.data.user)) {
    console.error(
      `[fw/guide] refusing to claim onto a non-guide account ${userId} (role=${String(account.data.user.app_metadata?.role)})`
    );
    return { ok: false, reason: "dead_link" };
  }

  // Before the burn: a rejected password must never cost the guide their link.
  const pw = validateStudentPassword(input.password, {});
  if (!pw.ok) return { ok: false, reason: "weak_password", message: pw.error };

  const claimedAt = new Date(input.now).toISOString();
  const claimed = await db
    .from("path_fw_guide_invites")
    .update({ claimed_at: claimedAt })
    .eq("id", inviteId)
    .eq("token_hash", tokenHash)
    .is("claimed_at", null)
    .select("id");
  if (claimed.error) {
    console.error(`[fw/guide] claim CAS failed: ${claimed.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((claimed.data ?? []).length === 0) {
    // Lost the race, or a re-issue rotated the hash while we were in flight.
    return { ok: false, reason: "dead_link" };
  }

  const updated = await db.auth.admin.updateUserById(userId, { password: input.password });
  if (updated.error) {
    console.error(`[fw/guide] password set failed for ${userId}: ${updated.error.message}`);
    // Release the claim so the link the guide is still holding keeps working.
    // CAS'd on the hash we claimed under: a re-issue that landed in between has
    // rotated it, and must not be un-claimed by us.
    const released = await db
      .from("path_fw_guide_invites")
      .update({ claimed_at: null })
      .eq("id", inviteId)
      .eq("token_hash", tokenHash);
    if (released.error) {
      console.error(
        `[fw/guide] claim release failed for ${inviteId}: ${released.error.message} — staff must re-issue`
      );
    }
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, userId, email: normalizeEmail(account.data.user.email ?? "") };
}
