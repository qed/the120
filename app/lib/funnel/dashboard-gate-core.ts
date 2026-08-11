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
import {
  loadActiveConsentVersionsByChild,
  realConsentWallDeps,
} from "@/app/lib/funnel/consent-wall-core";
import type { ConsentWallChildFacts } from "@/app/lib/funnel/consent-wall-rules";
import { VERIFIED_TASK_STATE } from "@/app/lib/fp/progress-core";
import {
  photoConsentVerdict,
  type PhotoConsentRow,
} from "@/app/api/fp/signup/consent-rules";
import {
  dashboardRegister,
  deriveHasPassword,
  familyHasFpChild,
  type DashboardGateChild,
} from "@/app/lib/funnel/session-rules";
import { hasChosenPassword, isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";
import type { RemapContext } from "@/app/lib/v3-signup/remap-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";

/**
 * The remap's contextual override facts for THIS family (`needsSetPasswordStep`).
 * Derived once here, then handed to every destination producer the dashboard
 * drives — the gate's redirect and each card's CTA — so the page cannot answer
 * "where does this family go" two different ways.
 *
 * The signed-out / read-failed shape is all-false, which is `needsSetPasswordStep`
 * = false: no override. Those shapes fail the gate open and render anyway, so
 * the value is never consulted; all-false is the honest "we do not know".
 */
const NO_REMAP_CONTEXT: RemapContext = {
  funnelStamped: false,
  passwordChosen: false,
  hasFpChild: false,
};

/** One raw child row as the gate's select returns it — untrusted wire shapes,
 *  coerced by the core, never by callers. */
export type DashboardGateChildRow = {
  id: unknown;
  applicant_state: unknown;
  created_at: unknown;
  status: unknown;
  arrived_at: unknown;
  /** The per-child FP discriminator (plan Unit 8) — see `isFpChild`. Optional
   *  on the wire type: a row read before this column was selected is a shape we
   *  must tolerate, and absent reads as "not FP" everywhere. */
  fp_username?: unknown;
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
  /**
   * Which of these children currently pass the PHOTO/COVER consent gate (plan
   * Unit 8) — `photoConsentVerdict` at >= `FP_PHOTO_CONSENT_MIN_VERSION`,
   * honouring the per-child tombstone. Service-role by necessity
   * (`fp_parental_consent` is RLS-on with zero policies); the only inputs are
   * child ids already returned by THIS request's RLS'd children read.
   *
   * null = the read failed. The dashboard then shows NEITHER the "give
   * permission" nor the "withdraw permission" affordance for anyone, which is
   * the honest degrade: offering "withdraw" to a family who never consented, or
   * "give permission" to one who just withdrew it, are both worse than offering
   * nothing until the next page load.
   */
  loadPhotoConsentChildIds: (
    childIds: readonly string[]
  ) => Promise<ReadonlySet<string> | null>;
  /**
   * THE CONSENT WALL's facts (founder, 2026-08-10): child id → the
   * `policy_version` of each of that child's ACTIVE (`revoked_at IS NULL`)
   * `fp_parental_consent` rows. A child with no active row is present with an
   * EMPTY list, which is precisely the state the wall fires on — so the map is
   * keyed over every child asked about, never only the ones with rows.
   *
   * Separate from `loadPhotoConsentChildIds` even though both read the same
   * table: that one answers a CAPABILITY question (photo anchor, tombstone,
   * decline evidence) and this one answers an EXISTENCE question. Folding them
   * would make a change to either gate silently move the other.
   *
   * Service-role by necessity (`fp_parental_consent` is RLS-on with zero
   * policies); the only inputs are child ids already returned by THIS request's
   * RLS'd children read. null = the read failed, and the wall predicate reads
   * null as "owes nothing" — a wall must never be erected on a hiccup.
   */
  loadActiveConsentVersions: (
    childIds: readonly string[]
  ) => Promise<ReadonlyMap<string, string[]> | null>;
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
        .select("id, applicant_state, created_at, status, arrived_at, fp_username")
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
    loadPhotoConsentChildIds: async (childIds) => {
      if (childIds.length === 0) return new Set<string>();
      // Service-role for the same reason as the counts above: fp_parental_consent
      // is RLS-on with ZERO policies, and the ids came from THIS request's RLS'd
      // children read. What crosses back is a set of ids, never evidence rows.
      try {
        const db = supabaseAdmin();
        const [consents, kids] = await Promise.all([
          db
            .from("fp_parental_consent")
            // `evidence` rides along for the verdict's photo_declined read
            // (fpv03 U3 review, FIX A) — the SAME shape /api/fp/cover reads,
            // so the dashboard can never offer what the endpoint refuses.
            .select("child_id, policy_version, accepted_at, revoked_at, evidence")
            .in("child_id", childIds as string[]),
          db
            .from("children")
            .select("id, photo_consent_revoked_at")
            .in("id", childIds as string[]),
        ]);
        if (consents.error || kids.error) return null;
        const tombstones = new Map<string, string | null>();
        for (const k of (kids.data as Array<Record<string, unknown>> | null) ?? []) {
          const stamp = k.photo_consent_revoked_at;
          tombstones.set(String(k.id), typeof stamp === "string" ? stamp : null);
        }
        const byChild = new Map<string, PhotoConsentRow[]>();
        for (const r of (consents.data as Array<Record<string, unknown>> | null) ?? []) {
          const id = String(r.child_id);
          const list = byChild.get(id) ?? [];
          list.push({
            policyVersion: typeof r.policy_version === "string" ? r.policy_version : null,
            acceptedAt: typeof r.accepted_at === "string" ? r.accepted_at : null,
            revokedAt: typeof r.revoked_at === "string" ? r.revoked_at : null,
            // Raw jsonb; the verdict narrows it (absent/malformed = no claim).
            evidence: r.evidence,
          });
          byChild.set(id, list);
        }
        const open = new Set<string>();
        for (const id of childIds) {
          // The SHARED pure gate — the same verdict `/api/fp/cover` enforces, so
          // the dashboard can never offer an affordance the endpoint refuses.
          const verdict = photoConsentVerdict({
            rows: byChild.get(id) ?? [],
            revokedAt: tombstones.get(id) ?? null,
          });
          if (verdict.ok) open.add(id);
        }
        return open;
      } catch {
        return null;
      }
    },
    loadActiveConsentVersions: async (childIds) => {
      // The SAME read the shared `requireConsentClear` control makes, through
      // the same core — so the page redirect and the action refusal can never
      // disagree about who owes a decision.
      try {
        return await loadActiveConsentVersionsByChild(realConsentWallDeps(), childIds);
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
  /** Child ids whose photo/cover consent gate is currently OPEN (plan Unit 8).
   *  null = not loaded (signed out / read failed) — the dashboard then offers
   *  neither consent affordance rather than guessing. */
  photoConsentChildIds: string[] | null;
  /**
   * THE CONSENT WALL's facts (founder, 2026-08-10), one entry per child with
   * that child's ACTIVE consent versions. Fed straight to the pure
   * `parentOwesConsentDecision`; null = signed out / read failed, which that
   * predicate reads as "owes nothing" (fail open — a wall is total).
   */
  consentWallChildren: ConsentWallChildFacts[] | null;
  /** The v2→v3 remap's contextual override facts for this family (v3 Unit 8
   *  review, FIX 1). Consumed by `dashboardGateVerdict` and by every card's
   *  `cardVerdict`, so the page has ONE answer per child. */
  remapCtx: RemapContext;
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
      return { hasSession: false, hasPassword: false, children: null, verifiedTaskCounts: null, photoConsentChildIds: null, consentWallChildren: null, remapCtx: NO_REMAP_CONTEXT };

    const childRows = await deps.loadChildRows();
    if (!childRows) {
      // The read failed, so the FP discriminator is UNKNOWN. Fall back to the
      // metadata bit alone, which is what this line always was: it can only
      // under-report `hasPassword`, and the verdict's `children: null` cell
      // fails open and renders regardless — a wrongly rendered dashboard
      // strands nobody.
      const hasPassword = deriveHasPassword({ appMetadata: user.appMetadata, children: null });
      return { hasSession: true, hasPassword, children: null, verifiedTaskCounts: null, photoConsentChildIds: null, consentWallChildren: null, remapCtx: NO_REMAP_CONTEXT };
    }
    // The FP discriminator is per CHILD, so `hasPassword` can only be derived
    // once the roster is in hand (plan Unit 8).
    const hasPassword = deriveHasPassword({
      appMetadata: user.appMetadata,
      children: childRows.map((c) => ({
        fpUsername: typeof c.fp_username === "string" ? c.fp_username : null,
      })),
    });

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
        return { hasSession: true, hasPassword, children: null, verifiedTaskCounts: null, photoConsentChildIds: null, consentWallChildren: null, remapCtx: NO_REMAP_CONTEXT };
      composed = loaded;
    }

    const children: DashboardGateChild[] = childRows.map((c) => ({
      id: String(c.id),
      applicantState: parseApplicantState(c.applicant_state),
      createdAt: String(c.created_at),
      hasComposedProject: composed.has(String(c.id)),
      status: c.status,
      // The sticky arrival fact (U11) — feeds dashboardRegister.
      arrivedAt: (c.arrived_at as string | null) ?? null,
      // The v3 FP discriminator (plan Unit 8) — feeds dashboardRegister, the
      // gate verdict's `childNextScreen` call, and `deriveHasPassword` above.
      fpUsername: typeof c.fp_username === "string" ? c.fp_username : null,
    }));

    // The screen-16 verified counts — only a PATH-REGISTER family renders them,
    // so only then is the read made; ALL child ids are asked about (the stat
    // box is "all children"; a child with no fp profile simply comes back
    // absent → 0). Unlike the reads above, a FAILURE here must not fail the
    // gate: the dashboard still renders, with the bars at the honest 0 floor.
    //
    // ⚠ THE CONDITION IS `dashboardRegister` ITSELF, NOT A COPY OF ITS
    // PREDICATE (plan Unit 8). This used to be a hand-inlined
    // `some(c => c.arrived_at != null)`, which is the same rule written twice —
    // and v3 is exactly the change that would have broken the pair: widening
    // the register to FP children without widening this line would have given
    // every v3 family a PERMANENT 0 FLOOR on the very bars the path register
    // exists to show. Calling the register function makes drift impossible
    // rather than merely unlikely.
    let verifiedTaskCounts: Record<string, number> | null = null;
    if (dashboardRegister(children) === "path") {
      const counts = await deps.loadVerifiedTaskCounts(children.map((c) => c.id));
      verifiedTaskCounts = counts === null ? null : Object.fromEntries(counts);
    }

    // The photo/cover consent state (plan Unit 8). Asked for EVERY child, not
    // just FP ones: a v2 applicant kid's parent may consent today so the cover
    // exists the moment that kid is provisioned. A failed read arrives as null
    // and the panel simply offers no consent affordance this page load.
    const consentOpen = await deps.loadPhotoConsentChildIds(children.map((c) => c.id));

    // THE CONSENT WALL's facts. Asked for EVERY child, and — critically — the
    // shape below is keyed over the ROSTER, not over the map: a child with no
    // consent rows at all is exactly the cohort this wall exists for, and they
    // come back ABSENT from the map. Iterating the map instead of the roster
    // would make the missing-record case invisible, which is the whole bug.
    const activeConsent = await deps.loadActiveConsentVersions(children.map((c) => c.id));
    const consentWallChildren: ConsentWallChildFacts[] | null =
      activeConsent === null
        ? null
        : children.map((c) => ({
            childId: c.id,
            activePolicyVersions: activeConsent.get(c.id) ?? [],
          }));

    return {
      hasSession: true,
      hasPassword,
      verifiedTaskCounts,
      photoConsentChildIds: consentOpen === null ? null : [...consentOpen],
      consentWallChildren,
      children,
      // The remap override facts, derived from the SAME roster the verdict and
      // the cards read (v3 Unit 8 review, FIX 1).
      remapCtx: {
        funnelStamped: isFunnelProvisioned(user.appMetadata),
        passwordChosen: hasChosenPassword(user.appMetadata),
        hasFpChild: familyHasFpChild(children),
      },
    };
  } catch {
    // Fail open: a wrongly rendered dashboard strands nobody.
    return { hasSession: false, hasPassword: false, children: null, verifiedTaskCounts: null, photoConsentChildIds: null, consentWallChildren: null, remapCtx: NO_REMAP_CONTEXT };
  }
}
