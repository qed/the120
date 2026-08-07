/**
 * First Profit CHILD CREATION (Slice B Unit 4; single-path since U14; R9). House
 * core-module pattern: NO "use server", NO `server-only` — the route hands in a
 * service-role `admin` client, a PARENT-TOKEN-SCOPED client factory, and a
 * couple of injected auth-account effects; tests hand in fakes. All the
 * wire-shaping (CORS, Bearer parse, one refusal, rate limit) lives in the thin
 * ./child/route.ts wrapper; this file is the SEQUENCING + compensation.
 *
 * Every First Profit child is created ONE way: the parent supplies a display
 * first name + a password, First Profit claims a globally-unique username
 * (fp_username, U12), and mints everything the child needs to log in and play: a
 * `public.children` roster row, a child auth account on the derived
 * non-deliverable `.invalid` address (`deriveStudentEmail(childId)`) carrying
 * the PARENT-SET password, the `path_student_profiles` child->user mapping (the
 * ensurePlayerProfile PRECONDITION), and the FP player profile + seeded save.
 * The whole mint is GATED on verifiable parental consent. The child then signs
 * in with their username (U13).
 *
 * (Slice B U14) The former path (b) — a parent requesting a PROVISIONED Google
 * Workspace address instead of a `.invalid` account — is REMOVED from child
 * creation: signup no longer branches on a `credentialChoice`, and the funnel
 * provisioning machinery (`provisionFpChildInline` et al.) is left DEFINED but
 * UNINVOKED by this flow, deferred to the future firstprofit.school email piece.
 *
 * ── the sequence (consent gates the MINT) ──
 *   1. resolve the caller's parent id from their Bearer token (getUser on the
 *      token-scoped client — this also proves the token is a genuine parent JWT);
 *   2. freshness: the attempt must be state='verified' and belong to THIS parent;
 *   3. insert the child row under the PARENT-TOKEN client, so RLS
 *      (`auth.uid() = parent_id`) authorizes it — NOT the service-role client
 *      (Plan Revision 1). This yields the childId consentGate needs;
 *   3b. claim a globally-unique fp_username via the service-role admin client
 *      (U12; fp_username is service-role-write-only), CAS-retrying on 23505;
 *   4. consentGate(admin, {attemptId, childId}) — ATOMICALLY CLAIMS the active
 *      consent for this child. Refuse => compensate (delete the child row) and
 *      return the refusal. Consent thus gates every step below it;
 *   5. mint the child auth account (email_confirm:true, the non-deliverable
 *      address lockout flag; validated password floor);
 *   6. create the path_student_profiles child->user row (the precondition
 *      ensurePlayerProfile assumes exists and never creates);
 *   7. ensurePlayerProfile — the FP profile + seeded save;
 *   8. advance the attempt to state='child_created'.
 *
 * ── no cross-call transaction => compensation (per the repo learning) ──
 * There is no transaction spanning the Auth API and PostgREST, so each resource
 * THIS call creates is tracked and, on any LATER failure, best-effort deleted in
 * REVERSE order: player profile+save -> path_student_profiles -> auth user ->
 * child row. The order is load-bearing: path_student_profiles and
 * fp_player_profiles both hold ON DELETE RESTRICT references to the child's
 * auth.users row AND the children row, so both profiles must be gone before the
 * account or the roster row can be deleted. A compensation delete that itself
 * fails leaves a durable STRANDED marker in the logs (Unit 2's posture). The
 * consent row's child_id FK is ON DELETE SET NULL, so deleting the child
 * UNBINDS the claimed consent automatically — a later retry can re-claim it.
 *
 * ── idempotency / retry ──
 * consentGate binds one consent to exactly one child. A retry that inserts a
 * NEW child row therefore fails the gate (`child_mismatch`) and compensates the
 * duplicate, so a double-submit can never mint two children against one consent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { consentGate } from "./consent-core";
import { ensurePlayerProfile } from "../login/profile-core";
import { ensurePathFamilyForParent } from "@/app/lib/fp/provision-core";
import { validateStudentPassword } from "@/app/lib/fp/provision-rules";
import { mintUsernameFromNames } from "@/app/lib/fp/fp-username-rules";
import { gradeVerdict } from "@/app/lib/funnel/child-rules";
import { APPLICANT_ENTRY_STATE } from "@/app/lib/funnel/applicant-rules";

/**
 * How many times the SERVICE-ROLE fp_username claim (an `admin` update of the
 * just-created child row) is re-attempted with a freshly-suffixed username after
 * a unique-index (23505) conflict on `children (lower(fp_username))`. A concurrent
 * create that grabbed our candidate first is the only realistic cause; a handful
 * of retries is plenty, and the numeric suffixer walks forward deterministically
 * (`alex` → `alex2` → …) each time. Because the child row is inserted BEFORE the
 * username is claimed (the username write is service-role-only — see step 5),
 * exhausting the retries leaves a username-LESS child, so it is COMPENSATED (the
 * child is deleted), never stranded.
 */
export const MAX_USERNAME_INSERT_RETRIES = 5;

/**
 * The funnel's own per-family cap (app/lib/funnel/children-core.ts
 * MAX_CHILDREN_PER_FAMILY). Redeclared here rather than imported because that
 * module is `server-only` and this core must stay a plain, testable module.
 * A guard against a stuck loop or a script, not a product cap anyone reaches.
 */
export const MAX_CHILDREN_PER_FAMILY = 10;

/* ------------------------------------------------------------------- deps */

export type CreateChildDeps = {
  /** Service-role client — consent gate, auth-account/profile writes, the
   *  service-role-only signup-attempt table, and every compensation delete. */
  admin: SupabaseClient;
  /** Factory for a PARENT-TOKEN-SCOPED RLS client (Rev 1). The child-row insert
   *  and the family cap-listing run under THIS client so `auth.uid() =
   *  parent_id` authorizes them — never the service-role client. */
  parentClient: (accessToken: string) => SupabaseClient;
  /** Mint the child auth account on the derived `.invalid` address with
   *  email_confirm:true (the route wires buildStudentCreateUserPayload) carrying
   *  the parent-set password. */
  createAuthUser: (input: {
    childId: string;
    password: string;
  }) => Promise<{ ok: true; userId: string } | { ok: false }>;
  /** Compensation: delete the child auth account (the `.invalid` account) THIS
   *  call minted. Returns ok:false when the delete itself failed so the caller
   *  can mark it stranded. */
  deleteAuthUser: (userId: string) => Promise<{ ok: boolean }>;
  now: () => number;
};

/* ------------------------------------------------------------------- input */

export type CreateChildInput = {
  attemptId: string;
  /** The parent's access token (Bearer), scoping the RLS child-row insert. */
  parentToken: string;
  /** The child's display first name (also the derived-handle + username seed). */
  firstName: string;
  /**
   * OPTIONAL last name (New User Flow v3 Unit 3). The FP HTTP door collects a
   * first name only and omits this, in which case EVERY behaviour below is
   * byte-identical to before: `mintUsernameFromNames` with no last name IS
   * `mintUsername`, and `last_name` keeps the column's `''` default.
   *
   * When present it does two things: it is stored on the roster row (the
   * dashboard and every downstream surface already read `children.last_name`),
   * and it widens the username base to `firstname.lastname` — the v3 handle
   * shape. It is deliberately NOT part of the password's name guard here;
   * `validateStudentPassword` is still called with the first name, and the v3
   * credential builder applies the stricter full-name check before it ever gets
   * this far.
   */
  lastName?: string | null;
  /**
   * Optional grade. First Profit's signup captures an age band, not a grade
   * (public.children.grade is nullable), so grade is only stored/validated when
   * the caller supplies it; when present it is coerced through the funnel's own
   * gradeVerdict guard (3-12 or refuse — never clamp).
   */
  grade?: number | string | null;
  /** The parent-set child password — REQUIRED, validated against the R29 student
   *  floor before any side effect. */
  childPassword: string;
};

export type CreateChildRefusal =
  | "unauthenticated"
  | "not_verified"
  | "parent_mismatch"
  | "invalid_child"
  | "too_many"
  | "weak_password"
  | "consent_required"
  | "outage";

export type CreateChildResult =
  // playerProfileId + username are present on a fresh mint; the idempotent-replay
  // success (attempt already 'child_created') carries only the existing childId.
  // `username` is the globally-unique fp_username the mint claimed (U12) — the
  // login key the FP confirmation shows the parent (U15). Never present on replay.
  | { ok: true; childId: string; playerProfileId?: string; username?: string }
  | {
      ok: false;
      reason: CreateChildRefusal;
      /** The consentGate reason (for logs/tests) when reason==='consent_required';
       *  the weak-password message when reason==='weak_password'. */
      detail?: string;
    };

/* ----------------------------------------------------------------- create */

export async function createChild(
  deps: CreateChildDeps,
  input: CreateChildInput
): Promise<CreateChildResult> {
  const { admin } = deps;

  // 1. Prove the token and resolve the caller's parent id. getUser verifies the
  //    JWT server-side, so an expired/forged token fails here before any write.
  const pc = deps.parentClient(input.parentToken);
  let parentId: string;
  try {
    const who = await pc.auth.getUser();
    if (who.error || !who.data?.user?.id) return { ok: false, reason: "unauthenticated" };
    parentId = who.data.user.id;
  } catch (err) {
    console.error(
      `[fp/signup/child] getUser threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, reason: "unauthenticated" };
  }

  // 2. Freshness: the attempt must be verified AND belong to this parent (the
  //    just-verified-parent invariant, re-read server-side — never trusted from
  //    the request body). NOTE (launch gate): child creation has NO launch gate
  //    of its own — it is gated TRANSITIVELY, because an attempt can only reach
  //    state='verified' by first clearing the signup-start launch gate.
  const attempt = await admin
    .from("fp_signup_attempts")
    .select("id, parent_id, state, child_id")
    .eq("id", input.attemptId)
    .maybeSingle();
  if (attempt.error) {
    console.error(`[fp/signup/child] attempt read failed: ${attempt.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = attempt.data as
    | { parent_id: string | null; state: string | null; child_id: string | null }
    | null;
  if (!row) return { ok: false, reason: "not_verified" };

  // Idempotent replay (a lost response): the child was ALREADY minted for THIS
  // attempt, so its state is 'child_created'. The state==='verified' freshness
  // check below would otherwise mis-refuse a genuine, playable child as
  // not_verified and hand the SPA a generic 401. Return the existing child_id
  // WITHOUT minting again. Still FAIL-CLOSED on ownership: a child_created
  // attempt owned by a different parent must never leak its child.
  if (row.state === "child_created") {
    if (!row.parent_id || row.parent_id !== parentId) {
      return { ok: false, reason: "parent_mismatch" };
    }
    if (row.child_id) return { ok: true, childId: row.child_id };
    // 'child_created' with no bound child_id is a corrupt marker, not a replay.
    return { ok: false, reason: "not_verified" };
  }

  if (row.state !== "verified") return { ok: false, reason: "not_verified" };
  if (!row.parent_id || row.parent_id !== parentId) return { ok: false, reason: "parent_mismatch" };

  // 3. Validate the pure inputs BEFORE any side effect: a bad name, a bad grade,
  //    or a weak password should never leave a child row behind to compensate.
  //    (Password strength is not a mint-gating concern — consent still gates the
  //    auth-account mint below; failing fast here only avoids wasted writes.)
  const firstName = input.firstName.trim();
  if (firstName.length === 0) return { ok: false, reason: "invalid_child" };
  // Bounded like the funnel's own name fields; an absent last name stays the
  // column's `''` default rather than becoming a literal "null".
  const lastName = (input.lastName ?? "").trim().slice(0, 80);
  let grade: number | null = null;
  if (input.grade !== undefined && input.grade !== null && input.grade !== "") {
    const verdict = gradeVerdict(input.grade);
    if (!verdict.ok) return { ok: false, reason: "invalid_child" };
    grade = verdict.grade;
  }
  // Validate the parent-set password up front — a weak password should never
  // leave a child row to compensate.
  const pw = validateStudentPassword(input.childPassword, { studentName: firstName });
  if (!pw.ok) return { ok: false, reason: "weak_password", detail: pw.error };

  // Track exactly what THIS call creates, for reverse-order compensation.
  const created: {
    childId: string | null;
    authUserId: string | null;
    profileId: string | null;
    playerProfileId: string | null;
  } = { childId: null, authUserId: null, profileId: null, playerProfileId: null };

  const compensate = async (stage: string): Promise<void> => {
    console.error(
      `[fp/signup/child] compensating at ${stage} for attempt ${input.attemptId} (parent ${parentId})`
    );
    await runCompensation(deps, created);
  };

  try {
    // 4. Enforce the per-family cap under the PARENT-TOKEN client (RLS-scoped —
    //    the parent sees only their own children). This is a NON-load-bearing
    //    stuck-loop / runaway-script guard: a deliberate check-then-act (NOT a
    //    post-write-verify), so a rare concurrent double-submit could momentarily
    //    exceed the cap. That has no compliance consequence — the cap is a courtesy
    //    ceiling nobody legitimately reaches, not a consent/verification invariant —
    //    so the simpler pre-write check is intentional.
    const listed = await pc.from("children").select("id").limit(MAX_CHILDREN_PER_FAMILY + 1);
    if (listed.error) {
      console.error(`[fp/signup/child] cap list failed: ${listed.error.message}`);
      return { ok: false, reason: "outage" };
    }
    if (((listed.data as unknown[] | null) ?? []).length >= MAX_CHILDREN_PER_FAMILY) {
      return { ok: false, reason: "too_many" };
    }

    // 5. Insert the child row under the PARENT-TOKEN client (Rev 1): RLS
    //    `with check (auth.uid() = parent_id)` authorizes it. Mirrors the funnel
    //    insertChild shape (draft + entry applicant_state) so an FP-signup child
    //    is a normal draft roster row.
    //
    //    (Slice B U12 — SECURITY review fix) fp_username is DELIBERATELY NOT part
    //    of this parent-token insert. The `children` RLS `with check (auth.uid()
    //    = parent_id)` pins row VALUES not COLUMNS, so a parent could otherwise
    //    write/squat fp_username over the GLOBAL login namespace (an enumeration
    //    oracle + a login-resolution break). A DB trigger (migration
    //    20260831120000) BLOCKS any non-service-role write of fp_username, so the
    //    child row is inserted WITHOUT one here (RLS still enforces parent_id =
    //    auth.uid()), and the username is claimed via the SERVICE-ROLE admin
    //    client in step 5b — the only principal the trigger admits.
    const insChild = await pc
      .from("children")
      .insert({
        parent_id: parentId,
        first_name: firstName,
        last_name: lastName,
        grade,
        status: "draft",
        applicant_state: APPLICANT_ENTRY_STATE,
      })
      .select("id")
      .single();
    if (insChild.error || !insChild.data) {
      console.error(`[fp/signup/child] child insert failed: ${insChild.error?.message ?? "no row"}`);
      return { ok: false, reason: "outage" };
    }
    const childId = String((insChild.data as { id: unknown }).id);
    // Track the child for compensation NOW — it exists before the username claim,
    // so a failed claim (below) must be able to tear it down. No window may leave
    // a permanently username-less child.
    created.childId = childId;

    // 5b. Claim a GLOBALLY-UNIQUE fp_username on the just-created child via the
    //     SERVICE-ROLE `admin` client (the ONLY principal the trigger lets write
    //     fp_username; the parent-token client is blocked). Uniqueness is
    //     arbitrated by the case-insensitive partial-unique index, and we CAS-retry
    //     on its 23505, re-picking the next suffix each time. The pre-seed taken-set
    //     — read on `admin` so it spans the WHOLE children space (a parent-token
    //     read sees only its own children under RLS) — is a best-effort fast path
    //     that trims conflicts; a read error just leans on the index + retry.
    const taken = new Set<string>();
    // Seed the taken-set from existing usernames sharing this child's base. The
    // base is `mintUsername`'s own (empty predicate → attempt 1 → the bare base),
    // which also applies the `student` fallback for an unfoldable first name, so
    // the `base%` prefix probe stays cheap and index-friendly either way.
    const seedBase = mintUsernameFromNames({ firstName, lastName, isTaken: () => false });
    if (seedBase.ok) {
      const existing = await admin
        .from("children")
        .select("fp_username")
        .ilike("fp_username", `${seedBase.base}%`);
      if (!existing.error) {
        for (const r of (existing.data as Array<{ fp_username?: unknown }> | null) ?? []) {
          if (typeof r.fp_username === "string") taken.add(r.fp_username.toLowerCase());
        }
      } else {
        console.error(
          `[fp/signup/child] username pre-seed read failed (non-fatal, index arbitrates): ${existing.error.message}`
        );
      }
    }

    let usernameClaimed = false;
    let claimedUsername = "";
    for (let attempt = 0; attempt < MAX_USERNAME_INSERT_RETRIES; attempt += 1) {
      const pick = mintUsernameFromNames({ firstName, lastName, isTaken: (c) => taken.has(c) });
      if (!pick.ok) {
        console.error(`[fp/signup/child] username exhausted for attempt ${input.attemptId}`);
        break;
      }
      const claim = await admin
        .from("children")
        .update({ fp_username: pick.username })
        .eq("id", childId)
        .select("id")
        .single();
      if (!claim.error && claim.data) {
        usernameClaimed = true;
        claimedUsername = pick.username;
        break;
      }
      // 23505 = the case-insensitive partial-unique index fired (a concurrent
      // writer grabbed this handle first). Mark it taken and re-pick the next
      // suffix; the row keeps its NULL fp_username, so a retry is clean. Any OTHER
      // error breaks out to the compensating unwind below.
      const code = (claim.error as { code?: unknown } | null)?.code;
      if (code === "23505") {
        taken.add(pick.username.toLowerCase());
        continue;
      }
      console.error(`[fp/signup/child] fp_username claim failed: ${claim.error?.message ?? "no row"}`);
      break;
    }
    if (!usernameClaimed) {
      // The child row is durably inserted but never got a username (retries
      // exhausted, or a hard claim error). A username-less child must never
      // survive — COMPENSATE it (delete) rather than strand it.
      console.error(
        `[fp/signup/child] fp_username claim exhausted/failed for child ${childId} (attempt ${input.attemptId}) — compensating`
      );
      await compensate("username-claim");
      return { ok: false, reason: "outage" };
    }

    // 6. CONSENT GATE — atomically claim the active consent for THIS child. This
    //    is the mint gate: nothing below runs without a valid, matching consent.
    const gate = await consentGate(admin, { attemptId: input.attemptId, childId });
    if (!gate.ok) {
      await compensate("consent-gate");
      // A TRANSIENT/infra gate outcome — a PostgREST blip on the CAS ("outage")
      // or an ambiguous multi-active read ("ambiguous") — is OUR fault, not a
      // missing consent. Map it to child-core's "outage" so the route releases
      // the rate-limit strike. Only a genuine consent problem
      // (missing | stale | child_mismatch) is terminal `consent_required`.
      if (gate.reason === "outage" || gate.reason === "ambiguous") {
        return { ok: false, reason: "outage" };
      }
      return { ok: false, reason: "consent_required", detail: gate.reason };
    }

    // 7. Establish the child's login identity: mint the `.invalid` account with
    //    the parent-set credential (email_confirm:true is inside the payload the
    //    route builds — mandatory on the non-deliverable address).
    const auth = await deps.createAuthUser({ childId, password: input.childPassword });
    if (!auth.ok) {
      await compensate("auth-create");
      return { ok: false, reason: "outage" };
    }
    const authUserId = auth.userId;
    created.authUserId = authUserId;

    // 8. Create the path_student_profiles child->user row — the precondition
    //    ensurePlayerProfile assumes and does NOT create. family_id is NOT NULL,
    //    so resolve (idempotently) the parent's path family; program_version_id
    //    is the current pinned version (no fallback, as provision-core does).
    const fam = await ensurePathFamilyForParent(admin, { userId: parentId });
    if (!fam.ok) {
      await compensate("path-family");
      return { ok: false, reason: "outage" };
    }
    const ver = await admin
      .from("path_program_versions")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (ver.error || typeof (ver.data as { id?: unknown } | null)?.id !== "string") {
      console.error(
        `[fp/signup/child] current program version load failed: ${ver.error?.message ?? "no is_current row"}`
      );
      await compensate("program-version");
      return { ok: false, reason: "outage" };
    }
    const programVersionId = String((ver.data as { id: unknown }).id);
    const insProfile = await admin
      .from("path_student_profiles")
      .insert({
        user_id: authUserId,
        child_id: childId,
        program_version_id: programVersionId,
        family_id: fam.familyId,
        cohort_id: null,
      })
      .select("id")
      .single();
    if (insProfile.error || !insProfile.data) {
      console.error(
        `[fp/signup/child] path_student_profiles insert failed: ${insProfile.error?.message ?? "no row"}`
      );
      await compensate("path-profile");
      return { ok: false, reason: "outage" };
    }
    created.profileId = String((insProfile.data as { id: unknown }).id);

    // 9. The FP player profile + seeded save (the precondition row now exists).
    const player = await ensurePlayerProfile(admin, {
      userId: authUserId,
      childId,
      firstName,
    });
    if (!player.ok) {
      console.error(`[fp/signup/child] ensurePlayerProfile refused: ${player.reason}`);
      await compensate("player-profile");
      return { ok: false, reason: "outage" };
    }
    created.playerProfileId = player.profileId;

    // 10. Advance the attempt. Non-fatal: the child is fully minted and playable
    //     now, so a failed state flip must NOT tear down a working child — it is
    //     a durable marker for ops, and consentGate already prevents a retry from
    //     minting a second child against the claimed consent.
    const advanced = await admin
      .from("fp_signup_attempts")
      .update({
        state: "child_created",
        child_id: childId,
        updated_at: new Date(deps.now()).toISOString(),
      })
      .eq("id", input.attemptId);
    if (advanced.error) {
      console.error(
        `[fp/signup/child] STRANDED STATE: child ${childId} minted for attempt ${input.attemptId} but state advance failed: ${advanced.error.message} — needs manual advance to 'child_created'`
      );
    }

    return { ok: true, childId, playerProfileId: player.profileId, username: claimedUsername };
  } catch (err) {
    console.error(
      `[fp/signup/child] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    await compensate("exception");
    return { ok: false, reason: "outage" };
  }
}

/* --------------------------------------------------------- compensation */

/**
 * Best-effort reverse-order teardown of exactly what THIS call created. Each
 * delete is guarded and its failure logged as a durable STRANDED marker (never
 * thrown — a compensation that throws would mask the real failure). Order is
 * load-bearing (RESTRICT FKs): saves+player-profile, then path_student_profiles,
 * then the auth account, then the roster row.
 */
async function runCompensation(
  deps: CreateChildDeps,
  created: {
    childId: string | null;
    authUserId: string | null;
    profileId: string | null;
    playerProfileId: string | null;
  }
): Promise<void> {
  const { admin } = deps;

  // FP player profile + its seeded save. Torn down by the KNOWN child_id (UNIQUE
  // on fp_player_profiles) rather than the captured playerProfileId, because
  // ensurePlayerProfile INSERTS the profile row BEFORE it seeds the save and, on
  // a save-seed error, returns save_seed_failed with NO profileId — leaving the
  // profile row committed but never captured in `created`. Keying the teardown on
  // child_id still removes that orphan; otherwise its ON DELETE RESTRICT FKs to
  // auth.users and children would block the auth-user and child deletes below,
  // stranding the minor's auth account and leaving the consent bound (its SET
  // NULL never fires) — which wedges every retry on consentGate child_mismatch.
  if (created.childId) {
    const found = await admin
      .from("fp_player_profiles")
      .select("id")
      .eq("child_id", created.childId)
      .maybeSingle();
    if (found.error) {
      console.error(
        `[fp/signup/child] STRANDED: fp_player_profiles lookup by child ${created.childId} failed: ${found.error.message}`
      );
    } else if (found.data && typeof (found.data as { id?: unknown }).id === "string") {
      const profileId = String((found.data as { id: unknown }).id);
      const saves = await admin.from("fp_player_saves").delete().eq("profile_id", profileId);
      if (saves.error) {
        console.error(
          `[fp/signup/child] STRANDED: fp_player_saves delete failed for profile ${profileId}: ${saves.error.message}`
        );
      }
      const prof = await admin.from("fp_player_profiles").delete().eq("id", profileId);
      if (prof.error) {
        console.error(
          `[fp/signup/child] STRANDED: fp_player_profiles delete failed for ${profileId}: ${prof.error.message}`
        );
      }
    }
  }

  if (created.profileId) {
    const psp = await admin.from("path_student_profiles").delete().eq("id", created.profileId);
    if (psp.error) {
      console.error(
        `[fp/signup/child] STRANDED: path_student_profiles delete failed for ${created.profileId}: ${psp.error.message}`
      );
    }
  }

  // Tear down the child's auth identity — the `.invalid` account THIS call
  // minted (created.authUserId). This runs BEFORE the child delete below, whose
  // RESTRICT referrers (both profiles) are already gone above.
  if (created.authUserId) {
    const del = await deps.deleteAuthUser(created.authUserId);
    if (!del.ok) {
      console.error(
        `[fp/signup/child] STRANDED ACCOUNT ${created.authUserId}: deleteUser failed during compensation — needs manual cleanup`
      );
    }
  }

  if (created.childId) {
    // Service-role delete: the roster row's RESTRICT referrers (both profiles)
    // are gone above, and the consent FK is ON DELETE SET NULL (unbinds), so a
    // later retry can re-claim the consent.
    const child = await admin.from("children").delete().eq("id", created.childId);
    if (child.error) {
      console.error(
        `[fp/signup/child] STRANDED: children delete failed for ${created.childId}: ${child.error.message}`
      );
    }
  }
}
