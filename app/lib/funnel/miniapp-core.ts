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
import { isApplicantState } from "@/app/lib/funnel/applicant-rules";
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
    writeGroup: (childId: string, slug: GroupSlug) => Promise<boolean>;
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
          const { error } = await supabase
            .from("children")
            .update({ group_slug: slug })
            .eq("id", childId);
          if (error) {
            console.error(`[funnel/miniapp] group write failed: ${error.message}`);
            return false;
          }
          return true;
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
    if (child.applicantState !== "added") return { kind: "invalid" };

    const wrote = await session.writeGroup(child.id, slug);
    if (!wrote) return { kind: "failed" };
    return { kind: "confirmed", slug, previousSlug: child.groupSlug || null };
  } catch (err) {
    console.error("[funnel/miniapp] confirm exception:", err);
    return { kind: "failed" };
  }
}
