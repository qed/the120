import "server-only";

/**
 * The dashboard gate's data loading (reconnect U2/U11), extracted from
 * `app/dashboard/page.tsx` behind an injectable seam so the fail-open
 * branches, the owingIds filter and the row mapping are executable in tests
 * (the resume-core pattern). The page keeps what must stay in the page: the
 * React `cache()` wrapper (zero-arg, so the memo key is the request itself —
 * the memoized-auth-gate learning) and `redirect()` outside any try.
 *
 * `server-only`, NOT `"use server"` — the deps parameter must never be
 * reachable from the wire (a Server Action's arguments arrive from the
 * client; docs/solutions/best-practices/shared-db-taking-core-must-not-live-
 * in-a-use-server-file-server-action-boundary-2026-07-17.md).
 *
 * Reads run as the SESSION user through PostgREST — RLS scopes them to the
 * family (children: `auth.uid() = parent_id`; projects: own children's
 * projects), no hand-written scope filter. ANY read failure returns
 * `children: null`, which the gate verdict treats as fail-open: render the
 * hub, never a broken redirect.
 *
 * ONE deliberate exception to the session-client rule: the Path verified-task
 * aggregate (`loadVerifiedTaskCounts`). The path_* tables are Decision 1 —
 * RLS enabled with ZERO policies, service-role only — so the session client
 * CANNOT read them, and per docs/solutions/security-issues/rls-enabled-zero-
 * policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md the access
 * story must name its client: this one is `supabaseAdmin`. The trust
 * reasoning: the only inputs are child ids ALREADY RETURNED by this request's
 * RLS'd children read (`auth.uid() = parent_id`) — no user/request input
 * reaches the query — and what crosses back is a read-only COUNT of a child's
 * own verified rows, never row data. Adding parent-session RLS policies
 * instead would break the Path graph's uniform service-role-only posture for
 * one derived number.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { VERIFIED_TASK_STATE } from "@/app/fp/lib/progress-core";
import { type DashboardGateChild } from "@/app/lib/funnel/session-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";
import { isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";

/** One raw child row as the gate's select returns it — untrusted wire shapes,
 *  coerced by the core, never by callers. */
export type DashboardGateChildRow = {
  id: unknown;
  applicant_state: unknown;
  created_at: unknown;
  status: unknown;
  arrived_at: unknown;
};

export type DashboardGateDeps = {
  /** The authenticated user, or null when there is no session. */
  getUser: () => Promise<{
    id: string;
    appMetadata: Record<string, unknown> | null;
  } | null>;
  /** The family's child rows, created_at ascending; null = read failed. */
  loadChildRows: () => Promise<DashboardGateChildRow[] | null>;
  /** Which of these children hold an active (composed) project; null = read
   *  failed. Only ever asked about `project_created` children (the owingIds
   *  filter) — the only cohort whose verdict consults the fact. */
  loadActiveProjectChildIds: (
    childIds: readonly string[]
  ) => Promise<ReadonlySet<string> | null>;
  /** Per-child VERIFIED task counts from the First Profit tables (child id →
   *  count). A child with no fp student profile is simply ABSENT from the map
   *  (the dashboard reads absence as a true 0); null = the read failed, which
   *  the core passes through as `verifiedTaskCounts: null` so the bars fall
   *  back to the floor — the dashboard must render either way. Only ever
   *  asked when the family is in the path register (some child arrived). */
  loadVerifiedTaskCounts: (
    childIds: readonly string[]
  ) => Promise<ReadonlyMap<string, number> | null>;
};

function realDeps(): DashboardGateDeps {
  // ONE server client per deps bundle: all three reads in a single gate pass
  // share the request's cookie-bound session.
  let clientPromise: ReturnType<typeof supabaseServer> | null = null;
  const client = () => (clientPromise ??= supabaseServer());
  return {
    getUser: async () => {
      const {
        data: { user },
      } = await (await client()).auth.getUser();
      return user ? { id: user.id, appMetadata: user.app_metadata ?? {} } : null;
    },
    loadChildRows: async () => {
      const { data, error } = await (await client())
        .from("children")
        .select("id, applicant_state, created_at, status, arrived_at")
        .order("created_at", { ascending: true });
      if (error || !data) return null;
      return data;
    },
    loadActiveProjectChildIds: async (childIds) => {
      const { data, error } = await (await client())
        .from("projects")
        .select("child_id")
        .eq("status", "active")
        .in("child_id", childIds as string[]);
      if (error) return null;
      return new Set((data ?? []).map((p) => String(p.child_id)));
    },
    loadVerifiedTaskCounts: async (childIds) => {
      // Service-role by necessity (Decision 1 tables — see the header note for
      // the trust reasoning); childIds came from THIS request's RLS'd children
      // read, nothing else ever reaches these filters.
      try {
        const db = supabaseAdmin();
        const { data: profiles, error } = await db
          .from("path_student_profiles")
          .select("id, child_id")
          .in("child_id", childIds as string[]);
        if (error || !profiles) return null;

        // One HEAD count per profile — a count can never be truncated, unlike
        // an unranged row select (the PostgREST max-rows-1000 lesson: docs/
        // solutions/integration-issues/postgrest-max-rows-1000-silently-
        // truncates-unranged-select-paginate-and-refuse-2026-07-24.md).
        // Families are small; this is at most a handful of cheap queries.
        const counted = await Promise.all(
          profiles.map(async (p) => {
            const { count, error: countError } = await db
              .from("path_task_progress")
              .select("id", { count: "exact", head: true })
              .eq("student_id", String(p.id))
              // The fp app's canonical count rule (VERIFIED_TASK_STATE): the
              // per-(student, task) uniqueness + pinned-version FK make this
              // DB count equal loadJourney's verifiedTotal fold.
              .eq("state", VERIFIED_TASK_STATE);
            if (countError || count === null) return null;
            return { childId: String(p.child_id), count };
          })
        );

        const counts = new Map<string, number>();
        for (const c of counted) {
          // Any failed per-profile count fails the WHOLE read: a partial map
          // would render one child's real progress next to a sibling's silent
          // zero — all-floor is honest, mixed is not.
          if (c === null) return null;
          counts.set(c.childId, c.count);
        }
        return counts;
      } catch {
        return null;
      }
    },
  };
}

export type DashboardGateFacts = {
  hasSession: boolean;
  hasPassword: boolean;
  children: DashboardGateChild[] | null;
  /** Child id → verified fp task count, loaded fresh on every page load (the
   *  screen-16 bars' freshness = per request; there is no client poll). A
   *  child with no fp profile is absent (renders as a true 0). null when the
   *  family is not in the path register OR the read failed — the dashboard
   *  renders the 0 floor either way (fail open, like every gate read). */
  verifiedTaskCounts: Record<string, number> | null;
};

/**
 * The server-side facts behind the dashboard gate. Every failure shape
 * carries `children: null` — the verdict's fail-open cell — and a thrown
 * anything degrades to the signed-out shape: a wrongly rendered dashboard
 * strands nobody.
 */
export async function loadDashboardGateFactsCore(
  deps: DashboardGateDeps = realDeps()
): Promise<DashboardGateFacts> {
  try {
    const user = await deps.getUser();
    if (!user)
      return { hasSession: false, hasPassword: false, children: null, verifiedTaskCounts: null };
    const hasPassword = !isFunnelProvisioned(user.appMetadata);

    const childRows = await deps.loadChildRows();
    if (!childRows)
      return { hasSession: true, hasPassword, children: null, verifiedTaskCounts: null };

    // The composed-project fact — only `project_created` children consult it
    // (childNextScreen), so only they are asked about, mirroring /start.
    const owingIds = childRows
      .filter((c) => parseApplicantState(c.applicant_state) === "project_created")
      .map((c) => String(c.id));
    let composed: ReadonlySet<string> = new Set<string>();
    if (owingIds.length > 0) {
      const loaded = await deps.loadActiveProjectChildIds(owingIds);
      // A failed projects read must NOT default toward the mini-app for a
      // family who really composed — fail the whole gate open instead.
      if (loaded === null)
        return { hasSession: true, hasPassword, children: null, verifiedTaskCounts: null };
      composed = loaded;
    }

    // The screen-16 verified counts — only a path-register family (some child
    // has EVER arrived, the sticky R12 fact) renders them, so only then is the
    // read made; ALL child ids are asked about (the stat box is "all
    // children"; a child with no fp profile simply comes back absent → 0).
    // Unlike the reads above, a FAILURE here must not fail the gate: the
    // dashboard still renders, with the bars at the honest 0 floor.
    let verifiedTaskCounts: Record<string, number> | null = null;
    if (childRows.some((c) => c.arrived_at != null)) {
      const counts = await deps.loadVerifiedTaskCounts(childRows.map((c) => String(c.id)));
      verifiedTaskCounts = counts === null ? null : Object.fromEntries(counts);
    }

    return {
      hasSession: true,
      hasPassword,
      verifiedTaskCounts,
      children: childRows.map((c) => ({
        id: String(c.id),
        applicantState: parseApplicantState(c.applicant_state),
        createdAt: String(c.created_at),
        hasComposedProject: composed.has(String(c.id)),
        status: c.status,
        // The sticky arrival fact (U11) — feeds dashboardRegister only.
        arrivedAt: (c.arrived_at as string | null) ?? null,
      })),
    };
  } catch {
    // Fail open: a wrongly rendered dashboard strands nobody.
    return { hasSession: false, hasPassword: false, children: null, verifiedTaskCounts: null };
  }
}
