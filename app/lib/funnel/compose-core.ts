import "server-only";

/**
 * AI composition — the server side (funnel U10). `server-only`, deps off the
 * wire; `actions/compose.ts` is the thin wrapper. Authorization is RLS, same
 * as the other funnel cores: no `supabaseAdmin`, ever.
 *
 * The write story — CLAIM BEFORE SPEND, both ways (the U10 review's
 * converging finding: a model call that runs before the row-level claim is
 * free money for whoever loses the race):
 * - `composeProjectCore` inserts the projects row FIRST, carrying the canned
 *   fallback (status `active`; the one-active-per-child partial index makes
 *   a second tab's insert a conflict, answered by returning the existing
 *   draft). Only the insert WINNER calls the model, then upgrades the row.
 *   A lost race or a failed insert costs zero model calls.
 * - `regenerateProjectCore` RESERVES the attempt with a CAS increment of
 *   `ai_regeneration_count` before any model call (R40: server-counted,
 *   Back cannot reset it, and N racing tabs buy exactly one attempt). A
 *   reserved attempt counts whether the model succeeds or falls back.
 * - `recordProjectEditCore` saves the family's edits and stamps
 *   `family_edited` (R40: the edit is recorded).
 * - The added → project_created advance is idempotent and re-issued on
 *   every re-entry path, so one transient failure can never strand the
 *   ladder behind an existing project.
 *
 * The moderation seam (U9's verification, discharged HERE): every answer
 * passes `moderateForModel` before any model call and the stored
 * `quiz_answers` copy passes `moderateAnswers` before any insert.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { GROUP_SLUGS, type GroupSlug } from "@/app/lib/site";
import {
  moderateAnswers,
  moderateForModel,
} from "@/app/lib/funnel/moderation";
import {
  TEMPLATES,
  quizBandForGrade,
} from "@/app/lib/funnel/quiz-rules";
import {
  canCreateProject,
  isEditLocked,
  isEditLockedDbError,
  parseApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import {
  assembleCompose,
  canRegenerate,
  composeBranch,
  composedProjectSchema,
  fallbackProject,
  sanitizeComposed,
  type CleanAnswers,
  type ComposedProject,
  type FallbackReason,
  type NormalizedModelResult,
} from "@/app/lib/funnel/compose-rules";
import {
  composeModelId,
  generateComposeDraft,
} from "@/app/lib/funnel/compose-model";

/* ─────────────────────────────── deps ─────────────────────────────── */

export type ProjectRow = {
  id: string;
  childId: string;
  groupSlug: string;
  name: string;
  description: string;
  offerSketch: string;
  firstCustomerHypothesis: string | null;
  templateId: string | null;
  aiRegenerationCount: number;
  quizAnswers: Record<string, string>;
};

export type ComposeDeps = {
  session: () => Promise<{
    userId: string | null;
    loadChild: (childId: string) => Promise<
      | { id: string; grade: number; groupSlug: string | null; applicantState: unknown }
      | null
      | "error"
    >;
    /** The child's ACTIVE project, if any (RLS-scoped). */
    loadActiveProject: (childId: string) => Promise<ProjectRow | null | "error">;
    loadProject: (projectId: string) => Promise<ProjectRow | null | "error">;
    /** R2's five-project cap needs the TOTAL count, not just the active row. */
    countProjects: (childId: string) => Promise<number | "error">;
    insertProject: (row: {
      childId: string;
      groupSlug: GroupSlug;
      project: ComposedProject;
      templateId: string | null;
      quizAnswers: Record<string, string>;
      aiModel: string | null;
    }) => Promise<{ kind: "inserted"; id: string } | { kind: "conflict" } | { kind: "failed" }>;
    /** CAS increment of ai_regeneration_count: succeeds only if the count is
     *  still `expectedCount`. The RESERVATION happens before any model call.
     *  `"locked"` (reconnect U7, R13): the projects_edit_horizon_guard
     *  trigger refused the write because the owning child is `submitted`+ —
     *  recognized via the P0120/funnel_edit_locked contract, and DISTINCT
     *  from `"error"` so the client never renders retry copy for it. */
    reserveRegeneration: (
      projectId: string,
      expectedCount: number
    ) => Promise<"reserved" | "conflict" | "locked" | "error">;
    /** Replace the draft fields (no counter change — the reservation or the
     *  insert already owns the slot). `"locked"` = the edit-horizon trigger
     *  refused (see reserveRegeneration). */
    saveDraft: (
      projectId: string,
      project: ComposedProject,
      aiModel: string | null
    ) => Promise<boolean | "locked">;
    saveEdit: (
      projectId: string,
      project: ComposedProject
    ) => Promise<boolean | "locked">;
    advanceToProjectCreated: (childId: string) => Promise<boolean>;
  }>;
  generate: (parts: { system: string; prompt: string }) => Promise<NormalizedModelResult>;
  /** R40a's "back off, then fall back": one real delay before the single
   *  transient retry. Injected so tests never sleep. */
  backoff: () => Promise<void>;
  modelId: () => string | null;
};

function realDeps(): ComposeDeps {
  return {
    generate: generateComposeDraft,
    backoff: () => new Promise((resolve) => setTimeout(resolve, 1500)),
    modelId: composeModelId,
    session: async () => {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const mapProject = (row: Record<string, unknown>): ProjectRow => ({
        id: String(row.id),
        childId: String(row.child_id),
        groupSlug: String(row.group_slug ?? ""),
        name: String(row.name ?? ""),
        description: String(row.description ?? ""),
        offerSketch: String(row.offer_sketch ?? ""),
        firstCustomerHypothesis: (row.first_customer_hypothesis as string | null) ?? null,
        templateId: (row.template_id as string | null) ?? null,
        aiRegenerationCount: Number(row.ai_regeneration_count ?? 0),
        quizAnswers:
          row.quiz_answers && typeof row.quiz_answers === "object"
            ? (row.quiz_answers as Record<string, string>)
            : {},
      });

      const PROJECT_COLUMNS =
        "id, child_id, group_slug, name, description, offer_sketch, first_customer_hypothesis, template_id, ai_regeneration_count, quiz_answers";

      return {
        userId: user?.id ?? null,
        loadChild: async (childId) => {
          const { data, error } = await supabase
            .from("children")
            .select("id, grade, group_slug, applicant_state")
            .eq("id", childId)
            .maybeSingle();
          if (error) return "error";
          if (!data) return null;
          return {
            id: String(data.id),
            grade: Number(data.grade ?? 0),
            groupSlug: (data.group_slug as string | null) || null,
            applicantState: data.applicant_state,
          };
        },
        loadActiveProject: async (childId) => {
          const { data, error } = await supabase
            .from("projects")
            .select(PROJECT_COLUMNS)
            .eq("child_id", childId)
            .eq("status", "active")
            .maybeSingle();
          if (error) return "error";
          return data ? mapProject(data) : null;
        },
        loadProject: async (projectId) => {
          const { data, error } = await supabase
            .from("projects")
            .select(PROJECT_COLUMNS)
            .eq("id", projectId)
            .maybeSingle();
          if (error) return "error";
          return data ? mapProject(data) : null;
        },
        insertProject: async (row) => {
          const { data, error } = await supabase
            .from("projects")
            .insert({
              child_id: row.childId,
              group_slug: row.groupSlug,
              name: row.project.name,
              description: row.project.description,
              offer_sketch: row.project.offerSketch,
              first_customer_hypothesis: row.project.firstCustomerHypothesis,
              status: "active",
              creation_route: row.templateId ? "template" : "own_idea",
              template_id: row.templateId,
              quiz_answers: row.quizAnswers,
              ai_model: row.aiModel,
              ai_generated_at: row.aiModel ? new Date().toISOString() : null,
            })
            .select("id")
            .single();
          if (error) {
            // 23505 on the one-active-per-child partial index: another tab
            // got there first. Not a failure — the caller re-loads.
            if (error.code === "23505") return { kind: "conflict" };
            console.error(`[funnel/compose] insert failed: ${error.message}`);
            return { kind: "failed" };
          }
          return { kind: "inserted", id: String(data.id) };
        },
        countProjects: async (childId) => {
          const { count, error } = await supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("child_id", childId);
          if (error) return "error";
          return count ?? 0;
        },
        reserveRegeneration: async (projectId, expectedCount) => {
          const { data, error } = await supabase
            .from("projects")
            .update({
              ai_regeneration_count: expectedCount + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId)
            .eq("ai_regeneration_count", expectedCount)
            .select("id");
          if (error) {
            if (isEditLockedDbError(error)) return "locked";
            console.error(`[funnel/compose] regen reserve failed: ${error.message}`);
            return "error";
          }
          return (data ?? []).length > 0 ? "reserved" : "conflict";
        },
        saveDraft: async (projectId, project, aiModel) => {
          const { error } = await supabase
            .from("projects")
            .update({
              name: project.name,
              description: project.description,
              offer_sketch: project.offerSketch,
              first_customer_hypothesis: project.firstCustomerHypothesis,
              ai_model: aiModel,
              ai_generated_at: aiModel ? new Date().toISOString() : null,
              family_edited: false,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
          if (error) {
            if (isEditLockedDbError(error)) return "locked";
            console.error(`[funnel/compose] draft write failed: ${error.message}`);
            return false;
          }
          return true;
        },
        saveEdit: async (projectId, project) => {
          const { error } = await supabase
            .from("projects")
            .update({
              name: project.name,
              description: project.description,
              offer_sketch: project.offerSketch,
              first_customer_hypothesis: project.firstCustomerHypothesis,
              family_edited: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
          if (error) {
            if (isEditLockedDbError(error)) return "locked";
            console.error(`[funnel/compose] edit write failed: ${error.message}`);
            return false;
          }
          return true;
        },
        advanceToProjectCreated: async (childId) => {
          // Guarded in SQL: only added → project_created; any other state is
          // left alone (idempotent re-entry, and never a backwards move).
          const { error } = await supabase
            .from("children")
            .update({ applicant_state: "project_created" })
            .eq("id", childId)
            .eq("applicant_state", "added");
          if (error) {
            console.error(`[funnel/compose] state advance failed: ${error.message}`);
            return false;
          }
          return true;
        },
      };
    },
  };
}

/* ─────────────────────────────── compose ─────────────────────────────── */

const composeInputSchema = z.object({
  childId: z.uuid(),
  /** null = the own-idea route. */
  templateId: z.string().max(60).nullable(),
  answers: z.object({
    what: z.string().max(2000),
    who: z.string().max(2000),
    offer: z.string().max(2000),
    spark: z.string().max(2000).optional(),
  }),
});

export type ProjectView = {
  id: string;
  project: ComposedProject;
  /** The group the PROJECT was born behind. The reveal renders THIS, not the
   *  child's currently-confirmed door — a door switch racing a failed state
   *  advance could otherwise label group X's project as group Y's (the U11
   *  adversarial finding). The card must be self-consistent. */
  groupSlug: string;
  regenerationsLeft: number;
};

export type ComposeResult =
  | { kind: "composed"; view: ProjectView; degraded: FallbackReason | null }
  | { kind: "exists"; view: ProjectView }
  | { kind: "input_rejected"; field: "what" | "who" | "offer" | "spark" }
  | { kind: "project_cap" }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** Reconnect U7 (R13): the edit-horizon trigger refused the write — the
   *  owning child is `submitted`+. Rendered as the locked explanation +
   *  admissions off-ramp, never retry copy. */
  | { kind: "locked" }
  | { kind: "failed" };

const REGEN_FIELDS = ["what", "who", "offer", "spark"] as const;

function moderatedCleanAnswers(
  answers: z.infer<typeof composeInputSchema>["answers"]
): { ok: true; clean: CleanAnswers } | { ok: false; field: (typeof REGEN_FIELDS)[number] } {
  const clean: Partial<CleanAnswers> = {};
  for (const field of REGEN_FIELDS) {
    const raw = answers[field];
    if (field === "spark" && (!raw || raw.trim().length === 0)) continue;
    const verdict = moderateForModel(raw ?? "");
    if (!verdict.ok) return { ok: false, field };
    clean[field] = verdict.clean;
  }
  return { ok: true, clean: clean as CleanAnswers };
}

const view = (
  id: string,
  project: ComposedProject,
  count: number,
  groupSlug: string
): ProjectView => ({
  id,
  project,
  groupSlug,
  regenerationsLeft: Math.max(0, 2 - count),
});

const rowToProject = (row: ProjectRow): ComposedProject => ({
  name: row.name,
  description: row.description,
  offerSketch: row.offerSketch,
  firstCustomerHypothesis: row.firstCustomerHypothesis,
});

/** One ask, with R40a's transient arm honoured: timeout/429 gets ONE real
 *  backoff and ONE retry before the taxonomy falls back. */
async function askModel(
  deps: ComposeDeps,
  parts: { system: string; prompt: string }
): Promise<NormalizedModelResult> {
  const first = await deps.generate(parts);
  if (first.type !== "timeout" && first.type !== "rate_limited") return first;
  await deps.backoff();
  return deps.generate(parts);
}

/** One model conversation: first ask (backoff-retried if transient), at most
 *  one re-ask, then the branch. Bounded at three provider calls. */
async function runCompose(
  deps: ComposeDeps,
  payloadParts: { system: string; prompt: string }
): Promise<
  | { outcome: "accept"; project: ComposedProject }
  | { outcome: "fallback"; reason: FallbackReason }
> {
  const first = composeBranch(await askModel(deps, payloadParts), { reasked: false });
  if (first.kind === "accept") return { outcome: "accept", project: first.project };
  if (first.kind === "fallback") return { outcome: "fallback", reason: first.reason };
  // Exactly one re-ask, with the validation error appended (R40a).
  const second = composeBranch(
    await deps.generate({
      system: payloadParts.system,
      prompt: `${payloadParts.prompt}\n\nYour previous answer was rejected: ${first.error}`,
    }),
    { reasked: true }
  );
  if (second.kind === "accept") return { outcome: "accept", project: second.project };
  return {
    outcome: "fallback",
    reason: second.kind === "fallback" ? second.reason : "invalid_after_reask",
  };
}

export async function composeProjectCore(
  input: unknown,
  deps: ComposeDeps = realDeps()
): Promise<ComposeResult> {
  try {
    const parsed = composeInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    const { childId, templateId, answers } = parsed.data;

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    const child = await session.loadChild(childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };
    if (!child.groupSlug || !(GROUP_SLUGS as readonly string[]).includes(child.groupSlug)) {
      // No confirmed door, no composition — the mini-app cannot have
      // legitimately reached this step.
      return { kind: "invalid" };
    }
    const group = child.groupSlug as GroupSlug;

    // A template must exist AND belong to the confirmed group — a stale or
    // cross-group id composes the wrong group's project (U9's top finding,
    // enforced server-side too).
    if (templateId !== null) {
      const template = TEMPLATES.find((t) => t.id === templateId);
      if (!template || template.group !== group) return { kind: "invalid" };
    }

    // Re-entry: an active draft already exists (refresh, Back, second tab).
    // The state advance re-issues here too — it is idempotent (SQL-guarded
    // added → project_created), and re-entry is the only path that can heal
    // a transiently-failed advance behind an existing row.
    const existing = await session.loadActiveProject(childId);
    if (existing === "error") return { kind: "failed" };
    if (existing) {
      await session.advanceToProjectCreated(childId);
      return {
        kind: "exists",
        view: view(existing.id, rowToProject(existing), existing.aiRegenerationCount, existing.groupSlug),
      };
    }

    // The edit horizon guards the INSERT path here, server-side (reconnect
    // U7 follow-up): the projects_edit_horizon_guard trigger is BEFORE
    // UPDATE only — deliberately, no INSERT arm — so a directly-invoked
    // compose for a submitted+ child with NO active project would otherwise
    // insert a fresh project past the horizon. Refuse with the same distinct
    // locked verdict before counting, moderating, or spending anything.
    // Unknown states parse to null (the CHECK constraint makes them
    // impossible); the trigger stays the fail-closed authority on updates.
    if (isEditLocked(parseApplicantState(child.applicantState))) {
      return { kind: "locked" };
    }

    // R2's cap: at most five projects per child, enforced at the only
    // creation site (dormant until a later unit ships non-active statuses,
    // but the guard belongs where the insert is).
    const total = await session.countProjects(childId);
    if (total === "error") return { kind: "failed" };
    if (!canCreateProject(total)) return { kind: "project_cap" };

    // U9's moderation seam, both halves: model pass per field (delimiter
    // rejection lives here), storage pass for the persisted copy.
    const moderated = moderatedCleanAnswers(answers);
    if (!moderated.ok) return { kind: "input_rejected", field: moderated.field };
    const storedAnswers = moderateAnswers(moderated.clean as Record<string, string>).clean;

    // CLAIM BEFORE SPEND: the row goes in FIRST, carrying the canned
    // fallback. The one-active partial index arbitrates races — only the
    // winner ever calls the model, and a failed insert costs zero model
    // calls (the review's converging finding: generate-then-insert made
    // every lost race and every insert failure a free model conversation).
    const fallback = fallbackProject(templateId, group, moderated.clean);
    const inserted = await session.insertProject({
      childId,
      groupSlug: group,
      project: fallback,
      templateId,
      quizAnswers: storedAnswers as Record<string, string>,
      aiModel: null,
    });
    if (inserted.kind === "failed") return { kind: "failed" };
    if (inserted.kind === "conflict") {
      const raced = await session.loadActiveProject(childId);
      if (raced === "error" || !raced) return { kind: "failed" };
      await session.advanceToProjectCreated(childId);
      return {
        kind: "exists",
        view: view(raced.id, rowToProject(raced), raced.aiRegenerationCount, raced.groupSlug),
      };
    }

    await session.advanceToProjectCreated(childId);

    const run = await runCompose(
      deps,
      assembleCompose({
        band: quizBandForGrade(child.grade),
        group,
        templateId,
        answers: moderated.clean,
      })
    );
    if (run.outcome === "accept") {
      const saved = await session.saveDraft(inserted.id, run.project, deps.modelId());
      // The horizon closed mid-flight (a submitted+ child with no active
      // project can only exist via staff/retention paths, but the trigger
      // is the authority): distinct verdict, no retry copy.
      if (saved === "locked") return { kind: "locked" };
      if (saved === true) {
        return { kind: "composed", view: view(inserted.id, run.project, 0, group), degraded: null };
      }
      // The model draft could not be persisted; the STORED row is the
      // fallback, and the view must say what the row says.
      return { kind: "composed", view: view(inserted.id, fallback, 0, group), degraded: "error" };
    }
    return {
      kind: "composed",
      view: view(inserted.id, fallback, 0, group),
      degraded: run.reason,
    };
  } catch (err) {
    console.error("[funnel/compose] compose exception:", err);
    return { kind: "failed" };
  }
}

/* ─────────────────────────────── read (for the page) ─────────────────────────────── */

export type ActiveProjectResult =
  | { kind: "ok"; view: ProjectView | null }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

/**
 * The page's server-side read: the child's active draft, if any, so the
 * compose/tasks/reveal steps survive a refresh without a client round-trip.
 * RLS scopes it; a child the session does not own reads as no project.
 */
export async function loadActiveProjectViewCore(
  childId: string,
  deps: ComposeDeps = realDeps()
): Promise<ActiveProjectResult> {
  try {
    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };
    const row = await session.loadActiveProject(childId);
    if (row === "error") return { kind: "failed" };
    return {
      kind: "ok",
      view: row ? view(row.id, rowToProject(row), row.aiRegenerationCount, row.groupSlug) : null,
    };
  } catch (err) {
    console.error("[funnel/compose] project read exception:", err);
    return { kind: "failed" };
  }
}

/* ─────────────────────────────── regenerate ─────────────────────────────── */

const regenerateInputSchema = z.object({ projectId: z.uuid() });

export type RegenerateResult =
  | { kind: "regenerated"; view: ProjectView; childId: string; degraded: FallbackReason | null }
  | { kind: "limit" }
  | { kind: "conflict" }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** Reconnect U7 (R13): edit horizon — see ComposeResult. */
  | { kind: "locked" }
  | { kind: "failed" };

export async function regenerateProjectCore(
  input: unknown,
  deps: ComposeDeps = realDeps()
): Promise<RegenerateResult> {
  try {
    const parsed = regenerateInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    const project = await session.loadProject(parsed.data.projectId);
    if (project === "error") return { kind: "failed" };
    if (!project) return { kind: "invalid" };

    // R40: the persisted counter is the ONLY authority. The third attempt is
    // refused HERE, before any model call — Back cannot reset this.
    if (!canRegenerate(project.aiRegenerationCount)) return { kind: "limit" };

    const child = await session.loadChild(project.childId);
    if (child === "error") return { kind: "failed" };
    if (!child) return { kind: "invalid" };
    if (!(GROUP_SLUGS as readonly string[]).includes(project.groupSlug)) {
      return { kind: "invalid" };
    }
    const group = project.groupSlug as GroupSlug;

    // The stored answers were moderated at compose time; re-verify anyway —
    // the model pass is cheap and the row could have been staff-edited.
    const answers: CleanAnswers = {
      what: project.quizAnswers.what ?? "",
      who: project.quizAnswers.who ?? "",
      offer: project.quizAnswers.offer ?? "",
      ...(project.quizAnswers.spark ? { spark: project.quizAnswers.spark } : {}),
    };
    const moderated = moderatedCleanAnswers(answers);
    if (!moderated.ok) return { kind: "invalid" };

    // RESERVE BEFORE SPEND (R40): the CAS increment happens before any model
    // call, so N racing tabs buy exactly one attempt — the losers conflict
    // here having spent nothing. The reserved attempt counts whether the
    // model accepts or falls back; attempts are what the cap prices.
    const reserved = await session.reserveRegeneration(
      project.id,
      project.aiRegenerationCount
    );
    if (reserved === "locked") return { kind: "locked" };
    if (reserved === "error") return { kind: "failed" };
    if (reserved === "conflict") return { kind: "conflict" };

    const run = await runCompose(
      deps,
      assembleCompose({
        band: quizBandForGrade(child.grade),
        group,
        templateId: project.templateId,
        answers: moderated.clean,
      })
    );
    const draft =
      run.outcome === "accept"
        ? run.project
        : fallbackProject(project.templateId, group, moderated.clean);
    const aiModel = run.outcome === "accept" ? deps.modelId() : null;

    const wrote = await session.saveDraft(project.id, draft, aiModel);
    // The reservation raced a submission: the attempt was reserved but the
    // horizon closed before the draft landed. Locked outranks failed — the
    // family needs the explanation, not a retry.
    if (wrote === "locked") return { kind: "locked" };
    if (!wrote) return { kind: "failed" };

    return {
      kind: "regenerated",
      view: view(project.id, draft, project.aiRegenerationCount + 1, project.groupSlug),
      childId: project.childId,
      degraded: run.outcome === "fallback" ? run.reason : null,
    };
  } catch (err) {
    console.error("[funnel/compose] regenerate exception:", err);
    return { kind: "failed" };
  }
}

/* ─────────────────────────────── edits (R40) ─────────────────────────────── */

const editInputSchema = z.object({
  projectId: z.uuid(),
  project: composedProjectSchema,
});

export type EditResult =
  | { kind: "saved"; project: ComposedProject }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  /** Reconnect U7 (R13): edit horizon — see ComposeResult. */
  | { kind: "locked" }
  | { kind: "failed" };

export async function recordProjectEditCore(
  input: unknown,
  deps: ComposeDeps = realDeps()
): Promise<EditResult> {
  try {
    const parsed = editInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };

    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };

    const project = await session.loadProject(parsed.data.projectId);
    if (project === "error") return { kind: "failed" };
    if (!project) return { kind: "invalid" };

    // Family edits are user input like any other: moderated before storage,
    // and the reserved fence characters are STRIPPED — the moderation
    // invariant is that no stored funnel text carries the delimiter, and a
    // future surface feeding project fields back into a prompt inherits
    // whatever this write allows. Stripping (not rejecting) because an
    // innocent paste should not bounce a family's edit.
    const stripped = {
      name: parsed.data.project.name.replace(/[⟦⟧]/g, ""),
      description: parsed.data.project.description.replace(/[⟦⟧]/g, ""),
      offerSketch: parsed.data.project.offerSketch.replace(/[⟦⟧]/g, ""),
      firstCustomerHypothesis:
        parsed.data.project.firstCustomerHypothesis === null
          ? null
          : parsed.data.project.firstCustomerHypothesis.replace(/[⟦⟧]/g, ""),
    };
    const clean = sanitizeComposed(stripped);
    const saved = await session.saveEdit(project.id, clean);
    if (saved === "locked") return { kind: "locked" };
    if (!saved) return { kind: "failed" };
    return { kind: "saved", project: clean };
  } catch (err) {
    console.error("[funnel/compose] edit exception:", err);
    return { kind: "failed" };
  }
}
