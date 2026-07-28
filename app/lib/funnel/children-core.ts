import "server-only";

/**
 * Add a Child, and the family's own children list (funnel U7; R31, R32).
 *
 * `server-only`, with the deps seam kept off the wire — `actions/children.ts`
 * holds the thin `"use server"` wrappers.
 *
 * ── Authorization ──
 * Decision 2's whole payoff: there is no hand-written family-scope check here.
 * Every read and write runs under the FAMILY'S OWN SESSION through
 * `supabaseServer()`, so the existing RLS policies (`children` is
 * `for all using (auth.uid() = parent_id)`) authorize it. A session for family
 * F requesting family G's child reads zero rows because Postgres says so, not
 * because this file remembered to check — which is the ~50 unenforced
 * authorization sites the earlier service-role design would have added.
 *
 * The one thing this file must not do is reach for `supabaseAdmin()`. Doing so
 * would bypass RLS and silently reintroduce exactly that surface, so it does
 * not import it at all and a test asserts the absence.
 *
 * ── The status guard ──
 * A funnel child is inserted at `status: "draft"` and stays there until C2.
 * That is load-bearing: `children_seed_group_assignment` early-returns on
 * draft, so door-switching (R35) cannot flood the staff review queue. The
 * funnel's own ladder lives on `applicant_state`, which starts at
 * `APPLICANT_ENTRY_STATE`.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { APPLICANT_ENTRY_STATE } from "@/app/lib/funnel/applicant-rules";
import {
  childDraftErrors,
  gradeVerdict,
  type ChildFieldError,
  type FunnelChild,
} from "@/app/lib/funnel/child-rules";

/** How many children one family may add. A guard against a stuck loop or a
 *  script, not a product cap anyone will reach — the plan's own example is
 *  three. Refused with copy, never silently dropped. */
export const MAX_CHILDREN_PER_FAMILY = 10;

export type ChildrenDeps = {
  session: () => Promise<{
    userId: string | null;
    listChildren: () => Promise<FunnelChild[] | null>;
    insertChild: (row: {
      firstName: string;
      grade: number;
    }) => Promise<{ id: string } | null>;
  }>;
};

function realDeps(): ChildrenDeps {
  return {
    session: async () => {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return {
        userId: user?.id ?? null,
        listChildren: async () => {
          // No .eq("parent_id", …): RLS scopes this to the caller's family.
          // Adding one would be harmless but would suggest the filter is what
          // protects the row, which is the misconception Decision 2 exists to
          // kill.
          const { data, error } = await supabase
            .from("children")
            .select("id, first_name, grade, applicant_state, created_at")
            .order("created_at", { ascending: true })
            .limit(MAX_CHILDREN_PER_FAMILY + 1);
          if (error) return null;
          return (data ?? []).map((c) => ({
            id: String(c.id),
            firstName: String(c.first_name ?? ""),
            grade: Number(c.grade ?? 0),
            applicantState: (c.applicant_state as string | null) ?? null,
            createdAt: String(c.created_at),
          }));
        },
        insertChild: async (row) => {
          const { data, error } = await supabase
            .from("children")
            .insert({
              parent_id: user?.id,
              first_name: row.firstName,
              grade: row.grade,
              // draft until C2 — see the header.
              status: "draft",
              applicant_state: APPLICANT_ENTRY_STATE,
            })
            .select("id")
            .single();
          if (error) {
            console.error(`[funnel/children] insert failed: ${error.message}`);
            return null;
          }
          return { id: String(data.id) };
        },
      };
    },
  };
}

const addSchema = z.object({
  firstName: z.string().max(120),
  grade: z.union([z.number(), z.string().max(4)]),
});

export type AddChildResult =
  | { kind: "added"; childId: string; children: FunnelChild[] }
  | { kind: "invalid"; fields: ChildFieldError[] }
  | { kind: "too_many" }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

export async function addChildCore(
  input: unknown,
  deps: ChildrenDeps = realDeps()
): Promise<AddChildResult> {
  try {
    const parsed = addSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid", fields: ["first_name", "grade"] };

    const draft = { firstName: parsed.data.firstName, grade: parsed.data.grade };
    const fieldErrors = childDraftErrors(draft);
    // Refuse before any DB call — a bad grade is not worth a round trip.
    if (fieldErrors.length > 0) return { kind: "invalid", fields: fieldErrors };

    const grade = gradeVerdict(draft.grade);
    if (!grade.ok) return { kind: "invalid", fields: ["grade"] };

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    const existing = await session.listChildren();
    if (existing === null) return { kind: "failed" };
    if (existing.length >= MAX_CHILDREN_PER_FAMILY) return { kind: "too_many" };

    const inserted = await session.insertChild({
      firstName: draft.firstName.trim(),
      grade: grade.grade,
    });
    if (!inserted) return { kind: "failed" };

    const after = await session.listChildren();
    return {
      kind: "added",
      childId: inserted.id,
      // Re-read rather than appending locally: the row the DB holds is the one
      // the guard may have rewritten, and the grid must show what is true.
      children: after ?? existing,
    };
  } catch (err) {
    console.error("[funnel/children] unexpected exception:", err);
    return { kind: "failed" };
  }
}

export type ListChildrenResult =
  | { kind: "ok"; children: FunnelChild[] }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

export async function listChildrenCore(
  deps: ChildrenDeps = realDeps()
): Promise<ListChildrenResult> {
  try {
    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };
    const children = await session.listChildren();
    if (children === null) return { kind: "failed" };
    return { kind: "ok", children };
  } catch (err) {
    console.error("[funnel/children] list exception:", err);
    return { kind: "failed" };
  }
}
