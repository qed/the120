/**
 * R28 data-rights erasure — the injected-db EXECUTOR (Slice B Unit 6). House
 * core pattern: NO "use server", NO `server-only` — the real deps come from
 * `realEraseFamilyDeps()` (provision-deps.ts) and tests inject fakes, so no real
 * DB is touched and no real Directory API is called in build/test. Every DECISION
 * about ORDER lives in `erase-family-rules.ts`; this file sequences the effects.
 *
 * Executes the full FK-safe deletion order END-TO-END for a family (see
 * erase-family-rules.ts for the order + the FK evidence). Properties:
 *   - IDEMPOTENT + RESUMABLE: every step is a delete that no-ops when the rows
 *     are already gone; a partial erasure re-run re-enumerates the survivors and
 *     finishes. RESTRICT guarantees a child is never half-deleted (its
 *     descendants are removed before the child row), so re-enumeration is always
 *     consistent.
 *   - The Workspace suspend+delete is GATED on `workspaceConfigured`: with no
 *     `GOOGLE_WORKSPACE_SA_KEY` the Google legs are skipped (counted `skipped`),
 *     exactly as provisioning parks `pending`. The one live exercise is Unit 11.
 *   - NEVER throws — returns a typed summary with an ordered operation log and a
 *     `stranded` list for any delete that failed (logged loudly, like the child-
 *     core compensation's STRANDED markers), so an operator can re-run or triage.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠ SECURITY — CALLER AUTHORIZATION IS NOT PERFORMED HERE (forward-guard). ║
 * ║ eraseFamily does NO authz of its own and is deliberately NOT yet wired to ║
 * ║ any route. The Unit 11 call site MUST be SERVICE-ROLE / ADMIN-GATED and   ║
 * ║ FAIL-CLOSED — a GET behind CRON_SECRET (or an equivalent admin gate), so  ║
 * ║ a normal principal can NEVER reach it. It hard-deletes an entire family's ║
 * ║ accounts, mailboxes, and consent evidence keyed ONLY on the ids passed in;║
 * ║ there is no ownership check inside. Do NOT expose it on a principal-       ║
 * ║ reachable path. (See the matching note on realEraseFamilyDeps.)           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeAuthUserIds,
  hasWorkspaceMailbox,
  RELEASED_CLAIM_PII_COLUMNS,
} from "./erase-family-rules";

export type EraseFamilyDeps = {
  /** Service-role client — every read + delete + the auth-account deletes. */
  db: SupabaseClient;
  /** admin.auth.admin.deleteUser wrapper; ok:false on a real failure (404 is
   *  treated as ok upstream — an already-gone account is a successful erasure). */
  deleteAuthUser: (userId: string) => Promise<{ ok: boolean }>;
  /** Directory suspend (idempotent: "missing" for a 404). */
  suspendWorkspaceUser: (email: string) => Promise<"suspended" | "missing" | "error">;
  /** Directory delete (idempotent: "missing" for a 404). Gated — see below. */
  deleteWorkspaceUser: (email: string) => Promise<"deleted" | "missing" | "error">;
  /** False when GOOGLE_WORKSPACE_SA_KEY is absent: the core SKIPS both Google
   *  legs entirely (no real Directory call in normal build/test). */
  workspaceConfigured: boolean;
  now: () => number;
};

export type EraseFamilyInput = {
  /** The parent's auth user id (== parents.id). Anchors the whole family. */
  parentUserId: string;
  /** The parent's signup email — a STABLE handle (never nulled) for finding
   *  fp_signup_attempts after the account FK has been SET NULL (resumability). */
  parentEmail: string;
  /**
   * Optional child-scoped erasure: restrict to these child ids (verified to
   * belong to the parent) and PRESERVE the parent account + parent-level
   * attempts. Omitted = full-family erasure (children + consent evidence +
   * parent account).
   */
  childIds?: readonly string[];
};

export type EraseFamilySummary = {
  ok: boolean;
  scope: "family" | "child";
  childrenErased: number;
  deleted: {
    fp_public_sites: number;
    fp_ledger: number;
    fp_player_saves: number;
    fp_player_profiles: number;
    path_student_profiles: number;
    children: number;
    authUsers: number;
    fp_parental_consent: number;
    fp_signup_attempts: number;
  };
  workspace: { suspended: number; deleted: number; missing: number; skipped: number; errored: number };
  /** Released provisioning claims whose residual PII was scrubbed after the child
   *  delete (row + local_part preserved; email/attempted-email/supabase_user_id
   *  nulled). See RELEASED_CLAIM_PII_COLUMNS. */
  scrubbedReleasedClaims: number;
  parentAccountDeleted: boolean;
  /** Ordered table-level operation log for auditing / order assertions. */
  order: string[];
  /** Rows/accounts whose delete failed — loud, for triage + re-run. */
  stranded: string[];
};

type Db = SupabaseClient;

/** Delete rows and return the count actually removed (PostgREST returns the
 *  deleted rows when `.select()` is chained). Records the op in the order log
 *  and any error in `stranded`. Idempotent: 0 rows is a valid no-op. */
async function del(
  db: Db,
  table: string,
  column: string,
  value: string | readonly string[],
  summary: EraseFamilySummary,
  label: string
): Promise<number> {
  const q = db.from(table).delete();
  const filtered = Array.isArray(value) ? q.in(column, value as string[]) : q.eq(column, value as string);
  const { data, error } = await filtered.select("*");
  if (error) {
    console.error(`[erase] STRANDED: ${table} delete (${label}) failed: ${error.message}`);
    summary.stranded.push(`${table}:${label}:${error.message}`);
    return 0;
  }
  const n = (data ?? []).length;
  if (n > 0) summary.order.push(`${table}:${label}(${n})`);
  return n;
}

type ChildRow = {
  childId: string;
  profileIds: string[];
  authUserIds: string[];
  workspaceEmail: string | null;
  /** The provisioning claim's stable row id (path b only), used to SCRUB its PII
   *  after the child delete releases it. `null` for a path-a child (no claim). */
  claimId: string | null;
};

/** Enumerate one child's owned rows across the FP + path graph. */
async function enumerateChild(db: Db, childId: string): Promise<ChildRow> {
  const [pp, psp, prov] = await Promise.all([
    db.from("fp_player_profiles").select("id, user_id").eq("child_id", childId),
    db.from("path_student_profiles").select("id, user_id").eq("child_id", childId),
    db
      .from("funnel_student_provisioning")
      .select("id, email, supabase_user_id, state")
      .eq("child_id", childId)
      .maybeSingle(),
  ]);
  const ppRows = (pp.data ?? []) as { id: string; user_id: string | null }[];
  const pspRows = (psp.data ?? []) as { id: string; user_id: string | null }[];
  const provRow =
    (prov.data as { id?: string | null; email?: string | null; supabase_user_id?: string | null } | null) ??
    null;
  return {
    childId,
    profileIds: ppRows.map((r) => r.id),
    // RESUMABILITY (FIX 1b): fold the claim's `supabase_user_id` into the auth-id
    // set. It is the path-b account's DURABLE handle — it survives the profile
    // deletes (steps 3-4), so a re-run after a mid-erase failure can still tear
    // the account down instead of orphaning it once the profile user_id rows are
    // gone. dedupe collapses it against the profile user_ids when both are present.
    authUserIds: dedupeAuthUserIds([
      ...ppRows.map((r) => r.user_id),
      ...pspRows.map((r) => r.user_id),
      provRow?.supabase_user_id ?? null,
    ]),
    workspaceEmail: provRow?.email ?? null,
    claimId: (provRow?.id as string | null) ?? null,
  };
}

/**
 * Erase a family (or a scoped subset of its children) in FK-safe order. Returns
 * a detailed summary; never throws. Re-runnable to completion after a partial
 * failure.
 *
 * CONCURRENCY: there is no cross-run lock. Two concurrent erasures of the same
 * family are ACCEPTABLE — every effect is an idempotent delete/scrub (a no-op on
 * already-gone rows), and RESTRICT keeps the order consistent — so a race yields
 * duplicated harmless work, never corruption. A lock is deliberately not added.
 */
export async function eraseFamily(
  deps: EraseFamilyDeps,
  input: EraseFamilyInput
): Promise<EraseFamilySummary> {
  const { db } = deps;
  const childScoped = input.childIds !== undefined;
  const summary: EraseFamilySummary = {
    ok: true,
    scope: childScoped ? "child" : "family",
    childrenErased: 0,
    deleted: {
      fp_public_sites: 0,
      fp_ledger: 0,
      fp_player_saves: 0,
      fp_player_profiles: 0,
      path_student_profiles: 0,
      children: 0,
      authUsers: 0,
      fp_parental_consent: 0,
      fp_signup_attempts: 0,
    },
    workspace: { suspended: 0, deleted: 0, missing: 0, skipped: 0, errored: 0 },
    scrubbedReleasedClaims: 0,
    parentAccountDeleted: false,
    order: [],
    stranded: [],
  };

  try {
    // ── Resolve the children in scope. Always re-read (resumability): a re-run
    //    sees only the survivors. Child-scoped runs verify ownership via the
    //    parent_id filter so a caller can never erase another family's child.
    let childQuery = db.from("children").select("id").eq("parent_id", input.parentUserId);
    if (childScoped) childQuery = childQuery.in("id", input.childIds as string[]);
    const childrenRes = await childQuery;
    if (childrenRes.error) {
      console.error(`[erase] children enumeration failed: ${childrenRes.error.message}`);
      summary.ok = false;
      summary.stranded.push(`children:enumerate:${childrenRes.error.message}`);
      return summary;
    }
    const childIds = ((childrenRes.data ?? []) as { id: string }[]).map((r) => r.id);

    // ── Per child, delete the leaf graph in FK-safe order, then the mailbox,
    //    then the child's own auth accounts, then the roster row.
    for (const childId of childIds) {
      const child = await enumerateChild(db, childId);
      // RESUMABILITY GUARD (FIX 1): any stranded marker this child accrues (a
      // failed auth delete, a workspace error, or a RESTRICT-blocked leaf delete)
      // must BLOCK the `children` anchor delete below, so a re-run re-enumerates
      // the survivor and summary.ok stays false. Snapshot the count to detect it.
      const strandedBefore = summary.stranded.length;

      // 0: fp_public_sites (RESTRICT -> fp_player_profiles) — the child's public
      //    page dies FIRST (the amended "sites → ledger → saves → profile →
      //    child" ordering, migration 20260907120000). Handle disposition is
      //    decided HERE, explicitly: deleting the row frees the handle and 404s
      //    the page. An OPERATOR-LOCKED row is still deleted — a data-rights
      //    erasure outranks a takedown lock — but NEVER SILENTLY: the release
      //    is logged loudly and recorded in the order log so the operator sees
      //    that a locked handle re-entered the pool via erasure.
      for (const profileId of child.profileIds) {
        const lockedSite = await db
          .from("fp_public_sites")
          .select("handle, operator_locked")
          .eq("profile_id", profileId)
          .maybeSingle();
        if (lockedSite.error) {
          // The lock read is OBSERVABILITY, not a gate: a failed read must not
          // block the erasure, but it must not silently skip the loud-release
          // rule either — log the ambiguity (possibly locked) and proceed; the
          // delete below strands loudly on its own if the DB is really down.
          console.error(
            `[erase] fp_public_sites lock read failed for profile ${profileId} (${lockedSite.error.message}) — proceeding; if this site was operator-locked, its handle release is NOT individually logged`
          );
          summary.order.push(`fp_public_sites:site-lock-read-failed(child:${childId})`);
        } else if ((lockedSite.data as { operator_locked?: unknown } | null)?.operator_locked === true) {
          console.error(
            `[erase] releasing an OPERATOR-LOCKED public-site handle via erasure (profile ${profileId}) — deliberate, not silent`
          );
          summary.order.push(`fp_public_sites:site-locked-released(child:${childId})`);
        }
        summary.deleted.fp_public_sites += await del(db, "fp_public_sites", "profile_id", profileId, summary, `child:${childId}`);
      }

      // 1-2: ledger + saves (both RESTRICT -> fp_player_profiles) — must precede
      //      the profile delete. Keyed on the profile ids.
      for (const profileId of child.profileIds) {
        summary.deleted.fp_ledger += await del(db, "fp_ledger", "profile_id", profileId, summary, `child:${childId}`);
        summary.deleted.fp_player_saves += await del(db, "fp_player_saves", "profile_id", profileId, summary, `child:${childId}`);
      }
      // 3: fp_player_profiles (RESTRICT -> children AND auth.users)
      summary.deleted.fp_player_profiles += await del(db, "fp_player_profiles", "child_id", childId, summary, `child:${childId}`);
      // 4: path_student_profiles (RESTRICT -> children AND auth.users)
      summary.deleted.path_student_profiles += await del(db, "path_student_profiles", "child_id", childId, summary, `child:${childId}`);

      // 5: Workspace mailbox (path b) — SUSPEND then DELETE, read the address
      //    BEFORE the child delete cascades the provisioning claim away.
      if (hasWorkspaceMailbox(child.workspaceEmail)) {
        if (!deps.workspaceConfigured) {
          summary.workspace.skipped++;
          summary.order.push(`workspace:skipped(${childId})`);
        } else {
          const email = child.workspaceEmail;
          const sus = await deps.suspendWorkspaceUser(email);
          if (sus === "suspended") summary.workspace.suspended++;
          else if (sus === "missing") summary.workspace.missing++;
          else {
            summary.workspace.errored++;
            summary.stranded.push(`workspace:suspend:${childId}`);
          }
          summary.order.push(`workspace:suspend:${sus}(${childId})`);
          // Delete regardless of a benign suspend "missing" (already gone); only
          // a hard suspend error blocks the delete (leave it for a re-run).
          if (sus !== "error") {
            const deld = await deps.deleteWorkspaceUser(email);
            if (deld === "deleted") summary.workspace.deleted++;
            else if (deld === "missing") summary.workspace.missing++;
            else {
              summary.workspace.errored++;
              summary.stranded.push(`workspace:delete:${childId}`);
            }
            summary.order.push(`workspace:delete:${deld}(${childId})`);
          }
        }
      }

      // 6: the child's own auth.users login accounts (now unreferenced).
      for (const authUserId of child.authUserIds) {
        const res = await deps.deleteAuthUser(authUserId);
        if (res.ok) {
          summary.deleted.authUsers++;
          summary.order.push(`auth_users:child:${childId}(${authUserId})`);
        } else {
          summary.stranded.push(`auth_users:${authUserId}`);
        }
      }

      // FIX 1c: a child still present with ZERO resolvable auth identities is a
      // partial-erasure resume (profiles already deleted, no claim to recover the
      // account from) or a corrupt row — NEVER anchor-delete it, or its orphaned
      // auth account would survive forever under a falsely ok:true summary. A
      // normally-erasable child always has at least one identity, so this only
      // fires on the anomaly. Fail-closed: strand it for triage.
      if (child.authUserIds.length === 0) {
        console.error(
          `[erase] STRANDED: child ${childId} has no resolvable auth identity while its anchor persists — preserving the anchor for re-enumeration`
        );
        summary.stranded.push(`children:no_identity:${childId}`);
      }

      // FIX 1a / FIX 4: if this child accrued ANY stranded marker (auth-delete not
      // ok, workspace error, RESTRICT-blocked leaf delete, or the no-identity guard
      // above), do NOT delete its `children` anchor. Leave it so a re-run
      // re-enumerates the survivor; summary.ok is already false.
      if (summary.stranded.length > strandedBefore) {
        summary.order.push(`children:stranded(${childId})`);
        continue;
      }

      // 7: the roster row. deposits CASCADE away; the provisioning claim does NOT —
      //    its child_id FK is ON DELETE SET NULL + a trigger flips it to released/
      //    child_deleted (the row + local_part SURVIVE, never-reissue ledger). The
      //    child-scoped consent evidence is removed here, while child_id still
      //    links, BEFORE the row is gone (the SET-NULL FK would otherwise unbind).
      if (childScoped) {
        summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "child_id", childId, summary, `child:${childId}`);
      }
      summary.deleted.children += await del(db, "children", "id", childId, summary, `child:${childId}`);
      summary.childrenErased++;

      // 7b (FIX 2): the child delete released the provisioning claim (child_id →
      //    null, state → released) but PRESERVED the row for never-reissue. A true
      //    erasure scrubs the residual PII off that surviving row — null email,
      //    workspace_attempted_email, supabase_user_id — while KEEPING local_part.
      //    Targeted by the claim's stable id (child_id is now null, so it can no
      //    longer be found by child).
      if (child.claimId) {
        const scrub: Record<string, null> = {};
        for (const col of RELEASED_CLAIM_PII_COLUMNS) scrub[col] = null;
        const { error } = await db
          .from("funnel_student_provisioning")
          .update(scrub)
          .eq("id", child.claimId);
        if (error) {
          console.error(
            `[erase] STRANDED: released-claim PII scrub failed for claim ${child.claimId}: ${error.message}`
          );
          summary.stranded.push(`funnel_student_provisioning:scrub:${child.claimId}:${error.message}`);
        } else {
          summary.scrubbedReleasedClaims++;
          summary.order.push(`funnel_student_provisioning:scrubbed(${childId})`);
        }
      }
    }

    // ── Family-level erasure only (childIds omitted): the deliberate final
    //    evidence step + the parent account. Anchored on parent_id (still set —
    //    the parent account is deleted only after) and parent_email (a stable
    //    handle if a prior partial run already nulled parent_id).
    if (!childScoped) {
      // 8: consent evidence — the EXPLICIT, deliberate final removal (see
      //    erase-family-rules.ts). fp_parental_consent by parent_id.
      summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "parent_id", input.parentUserId, summary, "family");

      // FIX 3 (security): fp_signup_attempts is deleted by parent_id — the
      // principal-scoped key. The parent_email scope is a FALLBACK used ONLY when
      // the parent_id delete matched nothing (a prior partial run already
      // SET-NULLed parent_id), NEVER as an unconditional second sweep: an unscoped
      // parent_email delete would destroy a DIFFERENT principal's attempt/consent
      // evidence that merely reused this email.
      const attemptsByParent = await del(db, "fp_signup_attempts", "parent_id", input.parentUserId, summary, "family:parent_id");
      summary.deleted.fp_signup_attempts += attemptsByParent;
      if (attemptsByParent === 0) {
        const attemptsByEmail = await del(db, "fp_signup_attempts", "parent_email", input.parentEmail, summary, "family:parent_email_fallback");
        summary.deleted.fp_signup_attempts += attemptsByEmail;
      }

      // 9: the parent auth account (CASCADE-removes parents -> children -> ...).
      //    RESUMABILITY GUARD (FIX 1): if ANY child was stranded above, its
      //    `children` anchor was deliberately preserved — but deleting the parent
      //    account here would CASCADE that anchor away (orphaning the account we
      //    could not delete). So skip the parent delete entirely while anything is
      //    stranded; the re-run finishes the children first, then removes the parent.
      if (summary.stranded.length > 0) {
        console.error(
          `[erase] parent account ${input.parentUserId} NOT deleted — ${summary.stranded.length} stranded item(s) still hold preserved anchors; re-run after triage`
        );
        summary.order.push(`auth_users:parent:deferred(${input.parentUserId})`);
      } else {
        const res = await deps.deleteAuthUser(input.parentUserId);
        if (res.ok) {
          summary.parentAccountDeleted = true;
          summary.order.push(`auth_users:parent(${input.parentUserId})`);
        } else {
          summary.stranded.push(`auth_users:parent:${input.parentUserId}`);
        }
      }
    }

    summary.ok = summary.stranded.length === 0;
    return summary;
  } catch (err) {
    console.error(`[erase] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    summary.ok = false;
    summary.stranded.push(`exception:${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }
}
