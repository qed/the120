import "server-only";

/**
 * Form-step saves + application submit — the server side of the merged
 * flow's application phase (unified-flow Unit 5; R6, R8, R9). `server-only`,
 * deps off the wire; `actions/form-steps.ts` is the thin wrapper. Mirrors
 * `compose-core.ts`: injectable deps, `input: unknown` + zod parse,
 * discriminated-union verdicts, never throw across the wire.
 *
 * ── The write discipline ──
 * - ONE children-row UPDATE per save, scoped to the session's child (RLS +
 *   the explicit id predicate). Ownership is the LOAD: RLS returns the child
 *   or nothing, and nothing is the same 404-shaped `invalid` as a garbage id
 *   — never an existence oracle.
 * - Content saves NEVER serialize `status` or `applicant_state` (the store's
 *   `childToRow` rule, carried over): the patch builders below cannot emit
 *   either key, and the test suite pins it.
 * - The dual lock verdict (`mergedLockVerdict` — funnel edit horizon OR
 *   legacy status lock) is enforced HERE before any write, with the
 *   group-until-deposit exception via `stepEditableInWalk`. Content-column
 *   read-only is app-enforced (the DB permits content writes at submitted+,
 *   Unit 3 probe p5) — the same guarantee level as today's wizard. The
 *   group step alone has a real DB gate (the deposit-keyed
 *   children_group_lock_guard), recognized as the distinct `locked` verdict.
 * - Submit is ONE mechanism for both cohorts (Unit 3, executed probes):
 *   a `children.status` draft→submitted patch with ECHO VERIFICATION.
 *   `applicant_state` is NEVER written — the `children_applicant_state_sync`
 *   trigger derives it off the status flip (a direct ladder write is
 *   silently coerced), and `children_seed_group_assignment` seeds the staff
 *   review row. Trigger-order quirk (probe p6): this patch may only ever
 *   carry the value 'submitted' — never reuse it for another status.
 *
 * ── PII discipline ──
 * Verdicts, event payloads, and error paths never echo form-field values
 * (child email, birth year, school, names): zod failures return
 * `{kind:"invalid"}` with nothing else, `incomplete` carries only the static
 * checklist labels, and nothing new lands in logs.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { GROUP_SLUGS, type GroupSlug } from "@/app/lib/site";
import { isEditLockedDbError } from "@/app/lib/funnel/applicant-rules";
import {
  mergedLockVerdict,
  stepEditableInWalk,
} from "@/app/lib/funnel/merged-flow-rules";
import {
  MERGED_FLOW_COLUMNS,
  mapMergedFlowRow,
  type MergedFlowFields,
} from "@/app/lib/funnel/miniapp-core";
import {
  GRADES,
  checklist,
  emptyChild,
  type Child,
  type SeatStatus,
} from "@/app/dashboard/data";

/* ─────────────────────────────── deps ─────────────────────────────── */

/** A content-column patch (snake_case, ready for the UPDATE). By
 *  construction the builders below never include `status`, `submitted_at`,
 *  or `applicant_state`; `updated_at` is stamped by the real deps, not the
 *  core, so tests assert exactly the content columns. */
export type FormStepPatch = Record<
  string,
  string | number | boolean | null | { subject: string; plan: string; goal: string }[]
>;

export type FormStepDeps = {
  session: () => Promise<{
    userId: string | null;
    /** RLS-scoped single-row read; null covers foreign AND absent alike. */
    loadChild: (childId: string) => Promise<MergedFlowFields | null | "error">;
    /** The DB group-lock guard's own predicate (live paid deposit). */
    depositPaid: (childId: string) => Promise<boolean | "error">;
    /** ONE UPDATE of content columns, id-scoped under RLS. `missing` = zero
     *  rows on a child the session just loaded (deleted underneath) — never
     *  reported as success. */
    saveFields: (
      childId: string,
      patch: FormStepPatch
    ) => Promise<"written" | "missing" | "failed">;
    /** The group step's write — R8's decided semantics: a DIRECT
     *  `group_slug` write (wizard semantics, project intact, no RPC).
     *  `locked` = the deposit-keyed children_group_lock_guard raised. */
    writeGroup: (
      childId: string,
      slug: GroupSlug
    ) => Promise<"written" | "locked" | "missing" | "failed">;
    /** The submit patch: status='submitted' (+ submitted_at) in a targeted
     *  UPDATE, echoing the row's post-trigger status back. `zero_rows` =
     *  the UPDATE matched nothing; `lost` = the request errored or the
     *  response was lost (the two-request submit hazard). */
    patchStatusSubmitted: (
      childId: string
    ) => Promise<{ status: string } | "zero_rows" | "lost">;
    /** The lost-response re-read (echo verification's second leg). */
    readStatus: (childId: string) => Promise<string | null | "error">;
  }>;
};

function realDeps(): FormStepDeps {
  return {
    session: async () => {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return {
        userId: user?.id ?? null,
        loadChild: async (childId) => {
          const { data, error } = await supabase
            .from("children")
            .select(MERGED_FLOW_COLUMNS)
            .eq("id", childId)
            .maybeSingle();
          if (error) return "error";
          return data ? mapMergedFlowRow(data as Record<string, unknown>) : null;
        },
        depositPaid: async (childId) => {
          const { data, error } = await supabase
            .from("deposits")
            .select("status, refunded_at")
            .eq("child_id", childId);
          if (error) return "error";
          return ((data as { status: string; refunded_at: string | null }[]) ?? []).some(
            (d) => d.status === "paid" && d.refunded_at === null
          );
        },
        saveFields: async (childId, patch) => {
          const { data, error } = await supabase
            .from("children")
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq("id", childId)
            .select("id");
          if (error) {
            // No field values in logs (PII) — the message names columns at
            // worst (DB shape constraints), never content.
            console.error(`[funnel/form-step] save failed: ${error.message}`);
            return "failed";
          }
          return (data ?? []).length > 0 ? "written" : "missing";
        },
        writeGroup: async (childId, slug) => {
          const { data, error } = await supabase
            .from("children")
            .update({ group_slug: slug, updated_at: new Date().toISOString() })
            .eq("id", childId)
            .select("id");
          if (error) {
            // The deposit-keyed guard raises a plain exception ("The group
            // is locked once a seat deposit is paid…") — plus the funnel's
            // P0120 contract for any future horizon guard. Both are the
            // DISTINCT locked verdict, never retry copy.
            if (
              isEditLockedDbError(error) ||
              /locked once a seat deposit/i.test(error.message ?? "")
            ) {
              return "locked";
            }
            console.error(`[funnel/form-step] group write failed: ${error.message}`);
            return "failed";
          }
          return (data ?? []).length > 0 ? "written" : "missing";
        },
        patchStatusSubmitted: async (childId) => {
          // The store's submit patch, verbatim semantics: 'submitted' is
          // HARDCODED (this patch has exactly one legitimate value — the
          // trigger-order quirk means any other value would desync the
          // ladder, probe p6), and the echo comes back in the same request.
          try {
            const { data, error } = await supabase
              .from("children")
              .update({
                status: "submitted",
                submitted_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", childId)
              .select("status")
              .maybeSingle();
            if (error) {
              console.error(`[funnel/form-step] submit patch failed: ${error.message}`);
              return "lost";
            }
            return data ? { status: String((data as { status: string }).status) } : "zero_rows";
          } catch (err) {
            console.error("[funnel/form-step] submit patch exception:", err);
            return "lost";
          }
        },
        readStatus: async (childId) => {
          const { data, error } = await supabase
            .from("children")
            .select("status")
            .eq("id", childId)
            .maybeSingle();
          if (error) return "error";
          return data ? String((data as { status: string }).status) : null;
        },
      };
    },
  };
}

/* ─────────────────────────────── input schemas ─────────────────────────────── */

const GRADE_MIN = GRADES[0];
const GRADE_MAX = GRADES[GRADES.length - 1];

const basicsSchema = z.object({
  step: z.literal("basics"),
  childId: z.uuid(),
  firstName: z.string().max(80),
  lastName: z.string().max(80),
  /** null = not chosen yet (the wizard's ""), never 0. */
  grade: z.number().int().min(GRADE_MIN).max(GRADE_MAX).nullable(),
  /** Partial typing is a legal draft value; the checklist decides done-ness. */
  birthYear: z.string().max(8).refine((v) => /^\d{0,4}$/.test(v.trim())),
  currentSchool: z.string().max(200),
  /** Data-URL photo, same storage as the wizard (V1); null clears nothing —
   *  it IS the stored value for "no photo". */
  photo: z.string().max(1_500_000).nullable(),
  childEmail: z.string().max(254),
  childEmailNone: z.boolean(),
});

const groupSchema = z.object({
  step: z.literal("group"),
  childId: z.uuid(),
  slug: z.string().max(40),
});

const academicsSchema = z.object({
  step: z.literal("academics"),
  childId: z.uuid(),
  academics: z
    .array(
      z.object({
        subject: z.string().max(120),
        // The tolerant-parse vocabulary: three plan ids or "".
        plan: z.enum(["catch-up", "reach-ahead", "get-solid", ""]),
        goal: z.string().max(500),
      })
    )
    .max(2),
  interests: z.string().max(2000),
});

const projectSchema = z.object({
  step: z.literal("project"),
  childId: z.uuid(),
  projectPitch: z.string().max(4000),
  portfolioLinks: z.string().max(2000),
});

const saveSchema = z.discriminatedUnion("step", [
  basicsSchema,
  groupSchema,
  academicsSchema,
  projectSchema,
]);

type SaveInput = z.infer<typeof saveSchema>;
export type FormStepId = SaveInput["step"];

/** The moderation invariant (U9/U10): no stored funnel text carries the
 *  fence delimiter — stripped (not rejected) so an innocent paste never
 *  bounces a family's save, matching `recordProjectEditCore`/`saveGoalCore`. */
const noFence = (s: string) => s.replace(/[⟦⟧]/g, "");

/**
 * The snake_case content patch per step. By construction: no `status`, no
 * `submitted_at`, no `applicant_state` — content saves cannot move either
 * vocabulary (the childToRow rule). The child-email pair keeps R48's mutual
 * exclusivity: "Don't have one" clears any typed address, and a
 * whitespace-only address stores as empty.
 */
function patchForStep(d: SaveInput): FormStepPatch {
  switch (d.step) {
    case "basics": {
      const none = d.childEmailNone === true;
      const email = none ? "" : noFence(d.childEmail).trim() === "" ? "" : noFence(d.childEmail);
      return {
        first_name: noFence(d.firstName),
        last_name: noFence(d.lastName),
        grade: d.grade,
        birth_year: d.birthYear.trim(),
        current_school: noFence(d.currentSchool),
        photo: d.photo,
        child_email: email,
        child_email_none: none,
      };
    }
    case "group":
      return { group_slug: d.slug };
    case "academics":
      return {
        academics: d.academics.map((a) => ({
          subject: noFence(a.subject),
          plan: a.plan,
          goal: noFence(a.goal),
        })),
        interests: noFence(d.interests),
      };
    case "project":
      return {
        project_pitch: noFence(d.projectPitch),
        portfolio_links: noFence(d.portfolioLinks),
      };
  }
}

/* ─────────────────────────────── save ─────────────────────────────── */

export type SaveFormStepResult =
  /** No field values ride back — the client already holds what it sent. */
  | { kind: "saved"; step: FormStepId }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** The dual lock (either vocabulary) refused, or the DB deposit guard
   *  raised on the group step — rendered as the locked explanation, never
   *  retry copy. */
  | { kind: "locked" }
  | { kind: "failed" };

export async function saveFormStepCore(
  input: unknown,
  deps: FormStepDeps = realDeps()
): Promise<SaveFormStepResult> {
  try {
    const parsed = saveSchema.safeParse(input);
    // PII: the verdict never echoes the offending input.
    if (!parsed.success) return { kind: "invalid" };
    const d = parsed.data;

    if (d.step === "group" && !(GROUP_SLUGS as readonly string[]).includes(d.slug)) {
      return { kind: "invalid" };
    }

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    // Ownership is the load: RLS returns the child or nothing, and nothing
    // is the same 404-shaped refusal as a garbage id.
    const child = await session.loadChild(d.childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };

    // The dual lock verdict, BEFORE any write (unit spec). `status` is a raw
    // string by design: an unknown value reads as "not draft" — locked,
    // fail-closed — never as an editable rung.
    const locked = mergedLockVerdict({
      applicantState: child.applicantState,
      status: child.status as SeatStatus,
    });
    // The deposit fact is only consulted where it can matter (the group
    // exception on a locked walk); a read failure refuses rather than
    // guessing — the DB guard would refuse the write anyway.
    let depositPaid = false;
    if (locked && d.step === "group") {
      const paid = await session.depositPaid(d.childId);
      if (paid === "error") return { kind: "failed" };
      depositPaid = paid;
    }
    if (!stepEditableInWalk(d.step, locked, depositPaid)) return { kind: "locked" };

    if (d.step === "group") {
      // R8's decided semantics: direct write, project intact, the
      // deposit-keyed DB guard closes the race this read cannot.
      const wrote = await session.writeGroup(d.childId, d.slug as GroupSlug);
      if (wrote === "locked") return { kind: "locked" };
      if (wrote === "missing") return { kind: "invalid" };
      if (wrote === "failed") return { kind: "failed" };
      return { kind: "saved", step: d.step };
    }

    const wrote = await session.saveFields(d.childId, patchForStep(d));
    // Zero rows on a child the session just loaded: the row vanished
    // underneath (deleted in another tab) — the 404 shape, never success.
    if (wrote === "missing") return { kind: "invalid" };
    if (wrote === "failed") return { kind: "failed" };
    return { kind: "saved", step: d.step };
  } catch (err) {
    console.error("[funnel/form-step] save exception:", err);
    return { kind: "failed" };
  }
}

/* ─────────────────────────────── submit ─────────────────────────────── */

const submitSchema = z.object({ childId: z.uuid() });

export type SubmitApplicationResult =
  | { kind: "submitted" }
  /** `missing` carries the STATIC checklist labels only — never a field
   *  value (PII discipline). */
  | { kind: "incomplete"; missing: string[] }
  /** A funnel child still at `added`: `added → submitted` has no legal edge
   *  (C1) — the review step points at the build instead. Zero writes. */
  | { kind: "finish_build" }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  | { kind: "locked" }
  | { kind: "failed" };

/**
 * Submit — the store's two-step semantics, server-side (Unit 3, executed
 * probes): the per-step saves already persisted every content column
 * (save-on-Next), so the "content flush" half is the walk itself; what
 * remains is the `children.status` draft→submitted patch with ECHO
 * VERIFICATION. The ladder (`applicant_state = 'submitted'`) derives via the
 * sync trigger and the staff review row seeds off the same flip — this core
 * NEVER writes `applicant_state` (a direct write is silently coerced).
 */
export async function submitApplicationCore(
  input: unknown,
  deps: FormStepDeps = realDeps()
): Promise<SubmitApplicationResult> {
  try {
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    const { childId } = parsed.data;

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    const child = await session.loadChild(childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };

    // The applicant LADDER gates submit for funnel children (C1): `added`
    // has no edge to `submitted`, whatever a stray projects row says.
    if (child.applicantState === "added") return { kind: "finish_build" };

    // Already sealed in either vocabulary → locked, zero writes. (A legacy
    // draft and a funnel `project_created` child both pass — the two
    // cohorts' one legal submit window.)
    if (
      mergedLockVerdict({
        applicantState: child.applicantState,
        status: child.status as SeatStatus,
      })
    ) {
      return { kind: "locked" };
    }

    // Completeness: the SAME checklist the meter renders (data.ts is the
    // one definition; its lockstep mirrors are nurture + CRM). Assembled
    // over the loaded row — server-persisted content, so unsaved keystrokes
    // cannot fake completeness.
    const assembled: Child = {
      ...emptyChild(child.id),
      firstName: child.firstName,
      lastName: child.lastName,
      grade: child.grade ?? "",
      birthYear: child.birthYear,
      currentSchool: child.currentSchool,
      groupSlug: child.groupSlug ?? "",
      academics: child.academics,
      subjects: child.subjects,
      interests: child.interests,
      projectPitch: child.projectPitch,
      portfolioLinks: child.portfolioLinks,
    };
    const missing = checklist(assembled)
      .filter((item) => !item.done)
      .map((item) => item.label);
    if (missing.length > 0) return { kind: "incomplete", missing };

    // The status patch + echo verification (the Clay Kliman lesson: the
    // guard COERCES, never raises, so a silently-kept status must surface
    // as failure — and a lost response must re-read before reporting one).
    const patched = await session.patchStatusSubmitted(childId);
    if (patched === "lost") {
      // The UPDATE may have committed while its response was lost —
      // reporting failure would unlock the form against a row staff
      // already see as submitted. Re-read once and adopt the row's truth.
      const reread = await session.readStatus(childId);
      if (reread === "error" || reread === null || reread === "draft") {
        return { kind: "failed" };
      }
      return { kind: "submitted" };
    }
    if (patched === "zero_rows") return { kind: "failed" };
    if (patched.status === "submitted") return { kind: "submitted" };
    if (patched.status !== "draft") {
      // Staff advanced the row past 'submitted' in the race window — the
      // write is fine and the row is further along than the client thinks.
      return { kind: "submitted" };
    }
    // Echoed 'draft': the flip did not take — retryable failure, never
    // fake success.
    return { kind: "failed" };
  } catch (err) {
    console.error("[funnel/form-step] submit exception:", err);
    return { kind: "failed" };
  }
}

// Goal saving deliberately lives elsewhere: the next-steps `saveGoalCore`
// (app/lib/funnel/next-steps-core.ts) already owns the family_goal write —
// reused as-is, never duplicated here (unit spec).
