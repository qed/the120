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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeAuthUserIds, hasWorkspaceMailbox } from "./erase-family-rules";

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
};

/** Enumerate one child's owned rows across the FP + path graph. */
async function enumerateChild(db: Db, childId: string): Promise<ChildRow> {
  const [pp, psp, prov] = await Promise.all([
    db.from("fp_player_profiles").select("id, user_id").eq("child_id", childId),
    db.from("path_student_profiles").select("id, user_id").eq("child_id", childId),
    db.from("funnel_student_provisioning").select("email, state").eq("child_id", childId).maybeSingle(),
  ]);
  const ppRows = (pp.data ?? []) as { id: string; user_id: string | null }[];
  const pspRows = (psp.data ?? []) as { id: string; user_id: string | null }[];
  const provEmail = (prov.data as { email?: string | null } | null)?.email ?? null;
  return {
    childId,
    profileIds: ppRows.map((r) => r.id),
    authUserIds: dedupeAuthUserIds([...ppRows.map((r) => r.user_id), ...pspRows.map((r) => r.user_id)]),
    workspaceEmail: provEmail,
  };
}

/**
 * Erase a family (or a scoped subset of its children) in FK-safe order. Returns
 * a detailed summary; never throws. Re-runnable to completion after a partial
 * failure.
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

      // 7: the roster row (CASCADE-removes funnel_student_provisioning + deposits).
      //    Child-scoped consent evidence is removed here, while child_id still
      //    links, BEFORE the row is gone (the SET-NULL FK would otherwise unbind).
      if (childScoped) {
        summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "child_id", childId, summary, `child:${childId}`);
      }
      summary.deleted.children += await del(db, "children", "id", childId, summary, `child:${childId}`);
      summary.childrenErased++;
    }

    // ── Family-level erasure only (childIds omitted): the deliberate final
    //    evidence step + the parent account. Anchored on parent_id (still set —
    //    the parent account is deleted only after) and parent_email (a stable
    //    handle if a prior partial run already nulled parent_id).
    if (!childScoped) {
      // 8: consent evidence — the EXPLICIT, deliberate final removal (see
      //    erase-family-rules.ts). fp_parental_consent by parent_id; the
      //    attempts by parent_id OR the stable parent_email.
      summary.deleted.fp_parental_consent += await del(db, "fp_parental_consent", "parent_id", input.parentUserId, summary, "family");
      const attemptsByParent = await del(db, "fp_signup_attempts", "parent_id", input.parentUserId, summary, "family:parent_id");
      const attemptsByEmail = await del(db, "fp_signup_attempts", "parent_email", input.parentEmail, summary, "family:parent_email");
      summary.deleted.fp_signup_attempts += attemptsByParent + attemptsByEmail;

      // 9: the parent auth account (CASCADE-removes parents + any residue).
      const res = await deps.deleteAuthUser(input.parentUserId);
      if (res.ok) {
        summary.parentAccountDeleted = true;
        summary.order.push(`auth_users:parent(${input.parentUserId})`);
      } else {
        summary.stranded.push(`auth_users:parent:${input.parentUserId}`);
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
