"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { type Child, type Parent, parseAcademics } from "./data";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";

/**
 * S1/S2: Supabase-backed dashboard store — READ SIDE ONLY since unified-flow
 * Unit 9. The dashboard is a launcher now: it loads the family (parent,
 * children, deposits, composed-project facts) and offers sign-out + deposit
 * refresh; every application write lives in the merged flow's server actions
 * (`form-step-core` — save-on-Next, dual lock check, echo-verified submit)
 * and child creation lives in `/start/children` (`children-core`).
 *
 * Retired write machinery (the wizard's owners, gone WITH the wizard so form
 * state never has two owners): the debounced per-child upsert chains, the
 * row serializer and the submit-status patch, tombstones, addChild/
 * updateChild/removeChild/saveChildNow — and the `loadFamily` prefill block,
 * whose responsibility MOVED to the flow's loader
 * (`prefillPatchForFields`/`persistPrefillCore`, miniapp-core) in the same
 * change: the seeding write has exactly one owner and never zero (the U12
 * row-honesty invariant — meter, CRM queue, and stall cron all read the raw
 * row). The ONE write left here is the parents-profile creation on a
 * confirm-email first visit, which was never wizard state.
 */

export type Deposit = { childId: string; status: string };

type Store = {
  ready: boolean;
  session: Session | null;
  parent: Parent | null;
  children: Child[];
  deposits: Deposit[];
  /** Children holding a composed (active) project — derived from the
   *  RLS-scoped active-projects read (reconnect U3), never a second query.
   *  Feeds `cardVerdict`'s hasComposedProject axis. */
  composedChildIds: ReadonlySet<string>;
  /** child id → the ACTIVE project's name, from the same read (2026-07-30):
   *  the card's status line says the project's name, never "Project
   *  created". The name always exists — compose inserts the row with the
   *  canned fallback name before the model ever runs. */
  projectNames: ReadonlyMap<string, string>;
  refreshDeposits: () => Promise<void>;
  signOut: () => void;
};

const DashboardContext = createContext<Store | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within <DashboardProvider>");
  return ctx;
}

/* ---------- row mapping (snake_case DB → camelCase app; read-only) ---------- */

export type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  grade: number | null;
  birth_year: string;
  current_school: string;
  photo: string | null;
  group_slug: string;
  academics: unknown; // jsonb — tolerant-parsed to Academic[]
  subjects: string[];
  workshop_ids: string[];
  interests: string;
  project_pitch: string;
  portfolio_links: string;
  child_email: string | null;
  child_email_none: boolean | null;
  status: Child["status"];
  submitted_at: string | null;
  /** Funnel ladder rung (reconnect U3); NULL for every pre-funnel child.
   *  The `select("*")` load already carries it. */
  applicant_state: string | null;
  /** The sticky arrival fact (reconnect U11) — non-null iff this child has
   *  EVER completed arrival. Server-stamped (provision driver), monotonic —
   *  and since U9 the store holds NO children write path at all. */
  arrived_at: string | null;
};

export function rowToChild(r: ChildRow): Child {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    grade: r.grade ?? "",
    birthYear: r.birth_year,
    currentSchool: r.current_school,
    photo: r.photo ?? undefined,
    groupSlug: r.group_slug ?? "",
    academics: parseAcademics(r.academics),
    subjects: r.subjects ?? [],
    workshopIds: r.workshop_ids ?? [],
    interests: r.interests,
    projectPitch: r.project_pitch,
    portfolioLinks: r.portfolio_links,
    childEmail: r.child_email ?? "",
    childEmailNone: r.child_email_none ?? false,
    status: r.status,
    submittedAt: r.submitted_at ?? undefined,
    // Fail-closed read: an unknown wire value drops to NULL (the legacy
    // card), never coerces to a rung the row does not hold.
    applicantState: parseApplicantState(r.applicant_state),
    arrivedAt: r.arrived_at ?? null,
  };
}

/* ---------- provider ---------- */

export default function DashboardProvider({ children: reactChildren }: { children: React.ReactNode }) {
  // Lazy: creating the client needs NEXT_PUBLIC_SUPABASE_* — deferred to the
  // browser so env-less builds can prerender this page (repo convention).
  const supabaseRef = useRef<ReturnType<typeof supabaseBrowser> | null>(null);
  const getSupabase = () => (supabaseRef.current ??= supabaseBrowser());
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [parent, setParent] = useState<Parent | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [composedChildIds, setComposedChildIds] = useState<ReadonlySet<string>>(new Set());
  const [projectNames, setProjectNames] = useState<ReadonlyMap<string, string>>(new Map());

  const loadFamily = useCallback(async (activeSession: Session) => {
    const supabase = getSupabase();
    const user = activeSession.user;
    const [parentRes, { data: childRows }, { data: depositRows }, { data: projectRows }] =
      await Promise.all([
        supabase.from("parents").select("first_name,last_name,email").eq("id", user.id).maybeSingle(),
        supabase.from("children").select("*").order("created_at"),
        supabase.from("deposits").select("child_id,status"),
        // The composed-project fact for the card verdicts (reconnect U3);
        // RLS scopes the read to this family's children (the U10 policy),
        // and the live-row scoping (`status='active'`) stays. The prefill
        // that used to consume this read moved to the flow's loader (U9).
        supabase.from("projects").select("child_id,name").eq("status", "active"),
      ]);
    let parentRow = parentRes.data;
    if (!parentRow && user.user_metadata?.first_name) {
      // Confirm-email signup flow: the profile was captured in auth metadata
      // because no session existed at signup (RLS blocks anonymous writes).
      // Create the parents row on the first signed-in visit, then fire
      // welcome email #1 (the route is idempotent).
      const m = user.user_metadata;
      const { error } = await supabase.from("parents").upsert({
        id: user.id,
        first_name: m.first_name ?? "",
        last_name: m.last_name ?? "",
        email: user.email ?? "",
        phone: m.phone ?? "",
        postal_code: m.postal_code ?? "",
        casl_consent: Boolean(m.casl_consent),
        casl_consent_at: m.casl_consent_at ?? new Date().toISOString(),
        heard_about: m.heard_about ?? "",
        referral_code: m.referral_code ?? "",
      });
      if (error) {
        console.error("[dashboard] profile create failed:", error.message);
      } else {
        parentRow = { first_name: m.first_name ?? "", last_name: m.last_name ?? "", email: user.email ?? "" };
        void fetch("/api/welcome", {
          method: "POST",
          headers: { Authorization: `Bearer ${activeSession.access_token}` },
        }).catch(() => {});
      }
    }
    setParent(
      parentRow
        ? { firstName: parentRow.first_name, lastName: parentRow.last_name, email: parentRow.email }
        : null
    );
    const activeProjects = (projectRows as { child_id: string; name: string | null }[]) ?? [];
    setComposedChildIds(new Set(activeProjects.map((row) => String(row.child_id))));
    setProjectNames(
      new Map(
        activeProjects
          .filter((row) => typeof row.name === "string" && row.name.trim() !== "")
          .map((row) => [String(row.child_id), String(row.name)])
      )
    );
    // The RAW rows, exactly as persisted (U9): the meter reads what the CRM
    // queue and the stall cron read — no in-memory prefill can make the
    // dashboard disagree with the row (the U12 row-honesty invariant; the
    // seeding itself happens in the flow's loader now).
    setChildren(((childRows as ChildRow[]) ?? []).map(rowToChild));
    setDeposits(
      ((depositRows as { child_id: string; status: string }[]) ?? []).map((d) => ({
        childId: d.child_id,
        status: d.status,
      }))
    );
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) await loadFamily(session);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) await loadFamily(newSession);
      else {
        setParent(null);
        setChildren([]);
        setDeposits([]);
        setComposedChildIds(new Set());
        setProjectNames(new Map());
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFamily]);

  const refreshDeposits = useCallback(async () => {
    const { data } = await getSupabase().from("deposits").select("child_id,status");
    setDeposits(
      ((data as { child_id: string; status: string }[]) ?? []).map((d) => ({
        childId: d.child_id,
        status: d.status,
      }))
    );
  }, []);

  const signOut = () => {
    getSupabase().auth.signOut();
  };

  return (
    <DashboardContext.Provider
      value={{
        ready,
        session,
        parent,
        children,
        deposits,
        composedChildIds,
        projectNames,
        refreshDeposits,
        signOut,
      }}
    >
      {reactChildren}
    </DashboardContext.Provider>
  );
}
