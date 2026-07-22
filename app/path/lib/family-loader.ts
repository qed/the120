import "server-only";

/**
 * The server-only read layer for the Unit 15 parent surfaces: the parent's
 * family context (which family, who its parents are, what to call it), the
 * roster's linkable founders, the per-child dashboard cards, and the pending
 * co-parent invites. Decisions live in `onboarding-rules.ts` (tested); this
 * file only composes queries and narrows rows — the journey-loader posture:
 * FAIL LOUD on query errors (throw a labeled error for the boundary), return
 * null only for a legitimate "not found".
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import type { RoleGrant } from "./access-rules";
import {
  deriveFounderCard,
  familyDisplayName,
  resolveLinkableFounders,
  type FounderCard,
  type FounderCardCriterion,
  type LinkableFounder,
} from "./onboarding-rules";
import { firstNameFromChildJoin, gradeFromChildJoin } from "./progress-core";
import { loadStudentContext } from "./progress-loader";
import { loadJourney } from "./journey-loader";
import { splitCriterionLabel } from "./now-card-rules";

type Db = ReturnType<typeof supabaseAdmin>;

/* ------------------------------------------------------------ family self */

export type ParentFamilyContext = {
  familyId: string;
  /** "Okafor family" / "Your family" — from the caller's CRM parents row. */
  familyLabel: string;
  /** Every parent/family grant holder — the ownership gate's membership set. */
  parentUserIds: string[];
  parentCount: number;
  /** Whether the CALLER has a public.parents row — the create path needs one
   *  (children.parent_id is a NOT NULL FK); an invited co-parent may not. */
  callerHasCrmParentRow: boolean;
};

/**
 * Resolve the signed-in user's family from their parent/family grant. Null when
 * the caller holds no parent grant (a student or guide — their surfaces are
 * elsewhere). T1 assumes one family per parent; the first grant wins and a
 * second is logged loudly rather than silently ignored.
 */
export async function resolveParentFamily(
  db: Db,
  viewer: { userId: string; grants: readonly RoleGrant[] }
): Promise<ParentFamilyContext | null> {
  const parentGrants = viewer.grants.filter(
    (g) => g.role === "parent" && g.scopeType === "family"
  );
  if (parentGrants.length === 0) return null;
  if (parentGrants.length > 1) {
    console.error(
      `[path/family] user ${viewer.userId} holds ${parentGrants.length} parent/family grants — rendering the first`
    );
  }
  const familyId = parentGrants[0].scopeId;

  const [members, callerParentRow] = await Promise.all([
    db
      .from("path_role_grants")
      .select("user_id")
      .eq("role", "parent")
      .eq("scope_type", "family")
      .eq("scope_id", familyId),
    db.from("parents").select("id, last_name").eq("id", viewer.userId).maybeSingle(),
  ]);
  if (members.error) {
    throw new Error(`resolveParentFamily(${familyId}) grants failed: ${members.error.message}`);
  }
  if (callerParentRow.error) {
    throw new Error(
      `resolveParentFamily(${viewer.userId}) parents failed: ${callerParentRow.error.message}`
    );
  }

  const parentUserIds = (members.data ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => typeof id === "string");

  // The family label comes from the caller's roster row when they have one;
  // an invited co-parent (no parents row) falls back to any co-parent's row.
  let lastName =
    typeof callerParentRow.data?.last_name === "string" ? callerParentRow.data.last_name : null;
  if (!lastName) {
    const others = parentUserIds.filter((id) => id !== viewer.userId);
    if (others.length > 0) {
      const other = await db
        .from("parents")
        .select("last_name")
        .in("id", others)
        .limit(1)
        .maybeSingle();
      if (other.error) {
        throw new Error(`resolveParentFamily co-parent lookup failed: ${other.error.message}`);
      }
      lastName = typeof other.data?.last_name === "string" ? other.data.last_name : null;
    }
  }

  return {
    familyId,
    familyLabel: familyDisplayName(lastName),
    parentUserIds,
    parentCount: parentUserIds.length,
    callerHasCrmParentRow: callerParentRow.data !== null,
  };
}

/* -------------------------------------------------------- linkable roster */

/**
 * The onboarding list: every roster child of the family's parents, resolved
 * through the pure link decision (linkable / needs_grade / provisioned).
 */
export async function loadLinkableFounders(
  db: Db,
  family: Pick<ParentFamilyContext, "familyId" | "parentUserIds">
): Promise<LinkableFounder[]> {
  if (family.parentUserIds.length === 0) return [];
  const [children, profiles] = await Promise.all([
    db
      .from("children")
      .select("id, first_name, grade")
      .in("parent_id", family.parentUserIds)
      .order("created_at", { ascending: true }),
    db.from("path_student_profiles").select("child_id").eq("family_id", family.familyId),
  ]);
  if (children.error) {
    throw new Error(`loadLinkableFounders(${family.familyId}) children failed: ${children.error.message}`);
  }
  if (profiles.error) {
    throw new Error(`loadLinkableFounders(${family.familyId}) profiles failed: ${profiles.error.message}`);
  }

  const provisioned = new Set(
    (profiles.data ?? [])
      .map((p) => p.child_id)
      .filter((id): id is string => typeof id === "string")
  );

  return resolveLinkableFounders(
    (children.data ?? []).map((c) => ({
      id: c.id as string,
      firstName: typeof c.first_name === "string" ? c.first_name : "",
      grade: typeof c.grade === "number" ? c.grade : null,
    })),
    provisioned
  );
}

/* ------------------------------------------------------- dashboard cards */

export type FounderCardWithIds = FounderCard & {
  profileId: string;
  childId: string;
};

/**
 * One dashboard card per provisioned child in the family — each child's whole
 * journey folded through the pure deriveFounderCard. R5: a parent sees
 * everything in-family, so no per-child access check is needed beyond the
 * family scoping of the profile query itself.
 */
export async function loadFounderCards(db: Db, familyId: string): Promise<FounderCardWithIds[]> {
  const profiles = await db
    .from("path_student_profiles")
    .select("id, child_id, children(first_name, grade)")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });
  if (profiles.error) {
    throw new Error(`loadFounderCards(${familyId}) profiles failed: ${profiles.error.message}`);
  }

  const cards: FounderCardWithIds[] = [];
  for (const row of profiles.data ?? []) {
    const profileId = row.id as string;
    const ctx = await loadStudentContext(db, profileId);
    if (!ctx) continue; // deleted mid-read — skip rather than throw
    const journey = await loadJourney(db, ctx, { pinnedTaskId: null });

    // Fold the loaded journey into the pure card input.
    const phases = journey.program.phases.map((phase) => ({
      num: phase.num,
      key: phase.key,
      criteria: phase.criteria.map((criterion): FounderCardCriterion => {
        const jc = journey.criteria[criterion.id];
        return {
          id: criterion.id,
          title: splitCriterionLabel(criterion.passCriterion).title,
          verifiedCount: jc.view.verifiedCount,
          taskTotal: jc.view.taskTotal,
          states: criterion.tasks.map((t) => jc.taskStates[t.id]),
        };
      }),
    }));

    let now: { criterionId: string; criterionTitle: string } | null = null;
    if (journey.now.kind === "task") {
      const nowTaskId = journey.now.taskId;
      const hit = journey.candidates.find((c) => c.taskId === nowTaskId);
      if (hit) {
        const criterion = journey.program.phases
          .flatMap((p) => p.criteria)
          .find((c) => c.id === hit.criterionId);
        if (criterion) {
          now = {
            criterionId: criterion.id,
            criterionTitle: splitCriterionLabel(criterion.passCriterion).title,
          };
        }
      }
    }

    cards.push({
      ...deriveFounderCard({
        firstName: firstNameFromChildJoin(row.children) ?? "",
        grade: gradeFromChildJoin(row.children),
        band: ctx.band,
        presentation: journey.presentation,
        verifiedTotal: journey.verifiedTotal,
        totalTasks: journey.totalTasks,
        phaseViews: journey.phaseViews,
        phases,
        now,
      }),
      profileId,
      childId: row.child_id as string,
    });
  }
  return cards;
}

/* ------------------------------------------------------- pending invites */

export type PendingInvite = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

/** Unaccepted invites for the dashboard list (expired ones render as such). */
export async function loadPendingInvites(
  db: Db,
  familyId: string,
  now: number
): Promise<PendingInvite[]> {
  const res = await db
    .from("path_parent_invites")
    .select("id, email, created_at, expires_at")
    .eq("family_id", familyId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (res.error) {
    throw new Error(`loadPendingInvites(${familyId}) failed: ${res.error.message}`);
  }
  return (res.data ?? []).map((r) => {
    const expiresAt = r.expires_at as string;
    const ms = Date.parse(expiresAt);
    return {
      id: r.id as string,
      email: r.email as string,
      createdAt: r.created_at as string,
      expiresAt,
      expired: !(Number.isFinite(ms) && ms > now),
    };
  });
}
