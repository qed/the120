"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { type Child, type Parent, parseAcademics } from "./data";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";

/**
 * S1/S2: Supabase-backed dashboard store — READ SIDE ONLY since unified-flow
 * Unit 9. The dashboard is a launcher now: it loads the family (parent +
 * children) and offers sign-out; every application write lives in the merged
 * flow's server actions (`form-step-core` — save-on-Next, dual lock check,
 * echo-verified submit) and child creation lives in `/start/children`
 * (`children-core`).
 *
 * fpv03 U4: the deposits and active-projects reads are GONE. The apps launcher
 * renders neither payment state nor the funnel card verdicts that consumed
 * them, so fetching two more tables per load was two Supabase reads for data
 * nothing renders. The payment ENDPOINTS stay dormant (founder decision); only
 * the dead fetches were removed.
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

type Store = {
  ready: boolean;
  session: Session | null;
  parent: Parent | null;
  children: Child[];
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
  /** The First Profit login handle (v3 Unit 8). Service-role-write-only
   *  (migration 20260831120000's trigger); the parent's RLS read sees it, which
   *  is what lets the credentials panel show it without a server round-trip. */
  fp_username?: string | null;
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
    fpUsername: r.fp_username ?? null,
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

  const loadFamily = useCallback(async (activeSession: Session) => {
    const supabase = getSupabase();
    const user = activeSession.user;
    const [parentRes, { data: childRows }] = await Promise.all([
      supabase.from("parents").select("first_name,last_name,email").eq("id", user.id).maybeSingle(),
      supabase.from("children").select("*").order("created_at"),
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
    // The RAW rows, exactly as persisted (U9): the meter reads what the CRM
    // queue and the stall cron read — no in-memory prefill can make the
    // dashboard disagree with the row (the U12 row-honesty invariant; the
    // seeding itself happens in the flow's loader now).
    setChildren(((childRows as ChildRow[]) ?? []).map(rowToChild));
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
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFamily]);

  // A bfcache-restored dashboard is a snapshot of an older session's data —
  // force a fresh load when the page returns from the back/forward cache
  // (2026-07-30, the wrong-company back-navigation report).
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
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
        signOut,
      }}
    >
      {reactChildren}
    </DashboardContext.Provider>
  );
}
