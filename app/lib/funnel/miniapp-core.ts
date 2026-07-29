import "server-only";

/**
 * The mini-app's server side (funnel U8) — load one child, confirm a door.
 * `server-only`, deps off the wire; `actions/miniapp.ts` is the thin wrapper.
 *
 * Authorization is RLS, same as children-core: no `supabaseAdmin`, no
 * hand-written scope check. A session for family F asking for family G's
 * child reads zero rows because Postgres says so — which is also the plan's
 * U8 verification ("no step is reachable by URL for a child the session does
 * not own").
 *
 * ── The write discipline (R35, the plan's trap list) ──
 * `confirmDoor` is the ONLY write in this module, and taps never reach it.
 * Door switching is client state; confirm persists `children.group_slug`
 * once. The seeding trigger early-returns on `status = 'draft'` — verified
 * against the trigger source, and the funnel keeps children draft until C2 —
 * so this write seeds no review row. The behavioural tests assert the write
 * COUNT, because persist-on-tap is invisible in any single-call test.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { GROUP_SLUGS, type GroupSlug } from "@/app/lib/site";
import {
  isApplicantState,
  isDoorChangeConflictDbError,
  isEditLocked,
  isEditLockedDbError,
} from "@/app/lib/funnel/applicant-rules";
import type { ApplicantState } from "@/app/lib/funnel/applicant-rules";

export type MiniAppChild = {
  id: string;
  firstName: string;
  grade: number;
  groupSlug: string | null;
  applicantState: ApplicantState | null;
  /** R36: the hint is first-child-only; the caller needs to know which this is. */
  isFirstChild: boolean;
};

export type MiniAppDeps = {
  session: () => Promise<{
    userId: string | null;
    loadChild: (childId: string) => Promise<
      | {
          id: string;
          firstName: string;
          grade: number;
          groupSlug: string | null;
          applicantState: unknown;
          isFirstChild: boolean;
        }
      | null
      | "error"
    >;
    /** Reconnect U7 (R13): the write is CONDITIONAL on the child's state —
     *  `WHERE applicant_state IN ('added','project_created')` — so a state
     *  advance between load and write (stale tab) refuses at the row, not
     *  in a check-then-write race. Zero rows on a child the session just
     *  loaded = the edit horizon closed = `"locked"`. NULL is deliberately
     *  NOT in the allow-set: a pre-funnel child is refused earlier (the
     *  `applicantState !== "added"` gate), and every child the mini-app
     *  legitimately serves entered the ladder at `added`. */
    writeGroup: (
      childId: string,
      slug: GroupSlug
    ) => Promise<"written" | "locked" | "failed">;
    /** Reconnect U8: the child's ACTIVE project, id + the raw CAS token
     *  (RLS-scoped). Server truth for "does a composed project exist" —
     *  the client's belief is only an echo to verify, never the fact. */
    loadActiveProject: (
      childId: string
    ) => Promise<{ id: string; aiRegenerationCount: number } | null | "error">;
    /** Reconnect U8 (R6): the ONE-transaction door change + project
     *  retirement — RPC change_door_and_invalidate_project (20260824120000,
     *  SECURITY INVOKER, edit-horizon condition embedded, CAS on
     *  ai_regeneration_count). Verdicts: `changed` (both writes landed),
     *  `locked` (the child left the pre-submission class — the children
     *  UPDATE matched zero rows, or the U7 trigger raised P0120),
     *  `conflict` (the P0121 raise: the echoed snapshot went stale, and
     *  the whole transaction — door write included — rolled back). */
    changeDoorAndInvalidate: (args: {
      childId: string;
      slug: GroupSlug;
      expectedProjectId: string;
      expectedRegenCount: number;
    }) => Promise<"changed" | "locked" | "conflict" | "failed">;
  }>;
};

function realDeps(): MiniAppDeps {
  return {
    session: async () => {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return {
        userId: user?.id ?? null,
        loadChild: async (childId) => {
          // RLS scopes both reads; the sibling read decides first-child-ness
          // by earliest created_at, matching the grid's ordering.
          const { data, error } = await supabase
            .from("children")
            .select("id, first_name, grade, group_slug, applicant_state, created_at")
            .order("created_at", { ascending: true })
            .limit(50);
          if (error) return "error";
          const rows = data ?? [];
          const child = rows.find((c) => String(c.id) === childId);
          if (!child) return null;
          return {
            id: String(child.id),
            firstName: String(child.first_name ?? ""),
            grade: Number(child.grade ?? 0),
            groupSlug: (child.group_slug as string | null) || null,
            applicantState: child.applicant_state,
            isFirstChild: rows.length > 0 && String(rows[0].id) === childId,
          };
        },
        writeGroup: async (childId, slug) => {
          // Conditional write (reconnect U7): the allow-set is the
          // pre-submission class. The caller already proved the row exists
          // and is visible to this session (loadChild), so zero rows here
          // means the state advanced past the horizon — locked, distinctly.
          const { data, error } = await supabase
            .from("children")
            .update({ group_slug: slug })
            .eq("id", childId)
            .in("applicant_state", ["added", "project_created"])
            .select("id");
          if (error) {
            console.error(`[funnel/miniapp] group write failed: ${error.message}`);
            return "failed";
          }
          return (data ?? []).length > 0 ? "written" : "locked";
        },
        loadActiveProject: async (childId) => {
          const { data, error } = await supabase
            .from("projects")
            .select("id, ai_regeneration_count")
            .eq("child_id", childId)
            .eq("status", "active")
            .maybeSingle();
          if (error) return "error";
          if (!data) return null;
          return {
            id: String(data.id),
            aiRegenerationCount: Number(data.ai_regeneration_count ?? 0),
          };
        },
        changeDoorAndInvalidate: async (args) => {
          // ONE statement, one transaction: the RPC does the conditional
          // children write and the CAS'd project retirement together, and
          // a conflict RAISES so both roll back — PostgREST surfaces the
          // SQLSTATE as error.code. SECURITY INVOKER: this session's RLS
          // scopes every row the function touches.
          const { data, error } = await supabase.rpc(
            "change_door_and_invalidate_project",
            {
              p_child_id: args.childId,
              p_new_slug: args.slug,
              p_expected_project_id: args.expectedProjectId,
              p_expected_regen_count: args.expectedRegenCount,
            }
          );
          if (error) {
            if (isDoorChangeConflictDbError(error)) return "conflict";
            // The U7 trigger raised inside the transaction (defense in
            // depth — the embedded state condition should refuse first).
            if (isEditLockedDbError(error)) return "locked";
            // 40P01 deadlock_detected — belt and braces UNDER the RPC's
            // standardized lock order (the FOR UPDATE on the project row
            // now precedes the children write, so this path should never
            // deadlock against the single-statement projects writers). If
            // a future writer with its own ordering still trips one,
            // Postgres killed exactly ONE transaction and NOTHING was
            // applied — which is the conflict contract (refresh/retry
            // guidance), never the generic failed copy.
            if (error.code === "40P01") return "conflict";
            console.error(`[funnel/miniapp] door change rpc failed: ${error.message}`);
            return "failed";
          }
          if (data === "changed" || data === "locked") return data;
          console.error(`[funnel/miniapp] door change rpc unexpected verdict: ${String(data)}`);
          return "failed";
        },
      };
    },
  };
}

export type LoadChildResult =
  | { kind: "ok"; child: MiniAppChild }
  | { kind: "not_found" }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

export async function loadMiniAppChild(
  childId: string,
  deps: MiniAppDeps = realDeps()
): Promise<LoadChildResult> {
  try {
    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };
    const child = await session.loadChild(childId);
    if (child === "error") return { kind: "failed" };
    // RLS makes "someone else's child" and "no such child" the SAME answer —
    // zero rows. Deliberate: distinguishing them would be an existence oracle.
    if (!child) return { kind: "not_found" };
    return {
      kind: "ok",
      child: {
        ...child,
        applicantState: isApplicantState(child.applicantState) ? child.applicantState : null,
      },
    };
  } catch (err) {
    console.error("[funnel/miniapp] load exception:", err);
    return { kind: "failed" };
  }
}

const confirmSchema = z.object({
  childId: z.uuid(),
  slug: z.string().max(40),
});

export type ConfirmDoorResult =
  | {
      kind: "confirmed";
      slug: GroupSlug;
      /** The child's group BEFORE this write — SERVER truth for the
       *  door_confirmed event (U16): null = first confirm; same slug =
       *  re-confirm (no event); different = a real switch. */
      previousSlug: string | null;
    }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** Reconnect U7 (R13): the child reached `submitted`+ between load and
   *  write — the edit horizon refused the row. Rendered as the locked
   *  explanation + admissions off-ramp, NEVER the generic retry copy. */
  | { kind: "locked" }
  | { kind: "failed" };

export async function confirmDoorCore(
  input: unknown,
  deps: MiniAppDeps = realDeps()
): Promise<ConfirmDoorResult> {
  try {
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    if (!(GROUP_SLUGS as readonly string[]).includes(parsed.data.slug)) {
      return { kind: "invalid" };
    }
    const slug = parsed.data.slug as GroupSlug;

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    // Ownership is the load: RLS returns the child or nothing.
    const child = await session.loadChild(parsed.data.childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };

    // A stale ?step=doors URL for a child already PAST the doors must not
    // silently reassign the group underneath quiz/compose state (U9+). Doors
    // belong to `added`; a NULL state (pre-funnel child reached by URL) is
    // refused too. Post-`added` group changes are a project operation (R2's
    // switching), not a door re-confirm.
    if (child.applicantState !== null && !isApplicantState(child.applicantState)) {
      return { kind: "invalid" };
    }
    // Reconnect U7: a child at-or-past `submitted` gets the DISTINCT locked
    // verdict (the shell renders the explanation + admissions off-ramp);
    // `project_created`/NULL keep the existing `invalid` (wrong room, not a
    // sealed application). The conditional write below closes the race this
    // read cannot.
    if (isApplicantState(child.applicantState) && isEditLocked(child.applicantState)) {
      return { kind: "locked" };
    }
    if (child.applicantState !== "added") return { kind: "invalid" };

    const wrote = await session.writeGroup(child.id, slug);
    if (wrote === "locked") return { kind: "locked" };
    if (wrote === "failed") return { kind: "failed" };
    return { kind: "confirmed", slug, previousSlug: child.groupSlug || null };
  } catch (err) {
    console.error("[funnel/miniapp] confirm exception:", err);
    return { kind: "failed" };
  }
}

/* ───────────────── door change on revisit (reconnect U8, R6/R7) ───────────────── */

const changeDoorSchema = z.object({
  childId: z.uuid(),
  slug: z.string().max(40),
  /** The snapshot echo — what the confirm dialog DISPLAYED (project id +
   *  raw regen count), not what the client currently believes. Null/absent
   *  = the client saw no composed project. */
  expectedProjectId: z.uuid().nullish(),
  expectedRegenCount: z.number().int().min(0).nullish(),
});

export type ChangeDoorResult =
  | {
      kind: "changed";
      slug: GroupSlug;
      /** SERVER truth for the door_confirmed event — see ConfirmDoorResult. */
      previousSlug: string | null;
    }
  /** The tapped door IS the persisted door — nothing to change, nothing
   *  written. The compare-against-server-fact rule, enforced in the core
   *  too, so no caller can turn a re-walk into a retirement. */
  | { kind: "unchanged" }
  /** The snapshot the dialog authorized went stale (concurrent regen, a
   *  second tab's door change, or a client that never knew about the
   *  project). NOTHING was applied — the RPC raises and the transaction
   *  rolls back whole. Rendered as refresh guidance, never retry copy. */
  | { kind: "conflict" }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** Reconnect U7 (R13): the edit horizon refused — see ConfirmDoorResult. */
  | { kind: "locked" }
  | { kind: "failed" };

/**
 * Change a confirmed door, retiring the composed project atomically when
 * one exists (dashboard reconnect U8, R6/R7).
 *
 * Unlike `confirmDoorCore` (first confirm, `added` only), this is the
 * post-confirm door CHANGE: legal at `added` AND `project_created` — the
 * same allow-set as the conditional writes it drives. Two server paths:
 *
 * - An ACTIVE project exists (server-read, not client-claimed): the write
 *   goes through the `change_door_and_invalidate_project` RPC — door write
 *   + project retirement in ONE transaction, CAS'd on the echoed
 *   `ai_regeneration_count`. The echo is REQUIRED: a client that shows no
 *   project while the server holds one is stale, and accepting its change
 *   would retire a project no dialog ever named (the version-echo rule) —
 *   refused as `conflict` before any write.
 * - No active project AND no echo: the plain conditional children write
 *   (writeGroup), exactly the pre-compose silent-reset path — no RPC, no
 *   transaction needed.
 * - An echo with NO matching active project (none at all, or an active row
 *   whose id differs from the echoed one) is REFUSED as `conflict`: the
 *   dialog authorized retiring a SPECIFIC snapshot, and the server no
 *   longer holds that fact — authorize the snapshot, refuse stale (the
 *   version-echo lesson). An earlier build let the stale echo proceed on
 *   the no-active path because "the authorized outcome results anyway";
 *   that deviation accepted an authorization no current fact backs, and
 *   is gone.
 *
 * The child stays `project_created` throughout — the state is truthful
 * (a project WAS created; the re-compose obligation is carried by the
 * `project_created`+no-project → compose landing rule, reconnect U1) and
 * no backwards transition exists to misuse.
 */
export async function changeDoorCore(
  input: unknown,
  deps: MiniAppDeps = realDeps()
): Promise<ChangeDoorResult> {
  try {
    const parsed = changeDoorSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    if (!(GROUP_SLUGS as readonly string[]).includes(parsed.data.slug)) {
      return { kind: "invalid" };
    }
    const slug = parsed.data.slug as GroupSlug;

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    // Ownership is the load: RLS returns the child or nothing.
    const child = await session.loadChild(parsed.data.childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };

    const state = isApplicantState(child.applicantState) ? child.applicantState : null;
    // At-or-past submitted: the DISTINCT locked verdict (the conditional
    // writes below are the guarantee; this read is the fast path).
    if (state !== null && isEditLocked(state)) return { kind: "locked" };
    // A pre-funnel child (NULL) has no funnel door to change; anything
    // else outside the pre-submission class is the wrong room.
    if (state !== "added" && state !== "project_created") return { kind: "invalid" };

    // Same door = no-op, by SERVER comparison — a re-walk that re-confirms
    // the persisted door must never write, never retire, never dialog.
    if (child.groupSlug === slug) return { kind: "unchanged" };

    // Does a composed project exist? SERVER truth decides the path — the
    // client's echo is only verified against it, never trusted for it.
    const active = await session.loadActiveProject(child.id);
    if (active === "error") return { kind: "failed" };

    if (active) {
      const { expectedProjectId, expectedRegenCount } = parsed.data;
      if (expectedProjectId == null || expectedRegenCount == null) {
        // The client rendered no project, so no dialog named this one —
        // its accept cannot authorize the retirement. Refresh first.
        return { kind: "conflict" };
      }
      if (expectedProjectId !== active.id) {
        // The dialog named a DIFFERENT project than the one now active
        // (retired-and-recomposed in another tab): the snapshot is stale.
        // Refuse BEFORE the RPC — authorize the snapshot, refuse stale
        // (the version-echo lesson); the RPC's CAS would conflict anyway,
        // but there is nothing to ask the database when the id itself
        // already disagrees.
        return { kind: "conflict" };
      }
      // Pass the ECHO, not the fresh read: the RPC's CAS decides against
      // the row atomically, and what it must match is what the dialog
      // displayed. (Re-reading here and passing the live values would
      // reintroduce the exact stale-snapshot authorization the echo
      // exists to prevent.)
      const changed = await session.changeDoorAndInvalidate({
        childId: child.id,
        slug,
        expectedProjectId,
        expectedRegenCount,
      });
      if (changed === "changed") {
        return { kind: "changed", slug, previousSlug: child.groupSlug || null };
      }
      if (changed === "locked") return { kind: "locked" };
      if (changed === "conflict") return { kind: "conflict" };
      return { kind: "failed" };
    }

    // No active project. An ECHO arriving here means the client's dialog
    // named a project the server no longer holds active (retired by
    // another tab): the accept authorized retiring THAT snapshot, and the
    // fact behind it is gone — conflict, refresh guidance, nothing written
    // (the version-echo lesson; see the header comment).
    if (parsed.data.expectedProjectId != null) return { kind: "conflict" };

    // No active project, no echo: the cheap tier — plain conditional
    // write, silent client-side reset. Same statement-level guard as
    // confirmDoorCore.
    const wrote = await session.writeGroup(child.id, slug);
    if (wrote === "locked") return { kind: "locked" };
    if (wrote === "failed") return { kind: "failed" };
    return { kind: "changed", slug, previousSlug: child.groupSlug || null };
  } catch (err) {
    console.error("[funnel/miniapp] door change exception:", err);
    return { kind: "failed" };
  }
}
