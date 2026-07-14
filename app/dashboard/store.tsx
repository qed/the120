"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { type Child, type Parent, emptyChild, parseAcademics } from "./data";

/**
 * S1/S2: Supabase-backed dashboard store (replaces localStorage V1).
 * Auth session gates the dashboard; children rows persist with a short
 * debounce so typing in the dossier editor doesn't spam the network.
 */

export type Deposit = { childId: string; status: string };

type Store = {
  ready: boolean;
  session: Session | null;
  parent: Parent | null;
  children: Child[];
  deposits: Deposit[];
  addChild: () => string;
  updateChild: (id: string, patch: Partial<Child>) => void;
  removeChild: (id: string) => void;
  saveChildNow: (
    id: string,
    opts?: { includeStatus?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  refreshDeposits: () => Promise<void>;
  signOut: () => void;
};

const DashboardContext = createContext<Store | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within <DashboardProvider>");
  return ctx;
}

/* ---------- row mapping (snake_case DB ↔ camelCase app) ---------- */

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
  test_scores: string;
  workshop_ids: string[];
  interests: string;
  project_pitch: string;
  portfolio_links: string;
  status: Child["status"];
  submitted_at: string | null;
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
    testScores: r.test_scores,
    workshopIds: r.workshop_ids ?? [],
    interests: r.interests,
    projectPitch: r.project_pitch,
    portfolioLinks: r.portfolio_links,
    status: r.status,
    submittedAt: r.submitted_at ?? undefined,
  };
}

export function childToRow(
  c: Child,
  parentId: string,
  opts?: { includeStatus?: boolean }
) {
  return {
    id: c.id,
    parent_id: parentId,
    first_name: c.firstName,
    last_name: c.lastName,
    grade: c.grade === "" ? null : c.grade,
    birth_year: c.birthYear,
    current_school: c.currentSchool,
    photo: c.photo ?? null,
    group_slug: c.groupSlug,
    academics: c.academics,
    // `subjects` round-trips state truth so the Academics prefill can clear
    // legacy entries once and have the clear persist (new rows insert []).
    subjects: c.subjects,
    test_scores: c.testScores,
    workshop_ids: c.workshopIds,
    interests: c.interests,
    project_pitch: c.projectPitch,
    portfolio_links: c.portfolioLinks,
    // status/submitted_at are sent ONLY on an explicit submit (includeStatus).
    // Ordinary saves never round-trip status, so a stale local status can't
    // collide with the DB's one-way status guard after staff advance the
    // child. New-row inserts default to 'draft' in the DB.
    ...(opts?.includeStatus
      ? { status: c.status, submitted_at: c.submittedAt ?? null }
      : {}),
    updated_at: new Date().toISOString(),
  };
}

/** Map DB-guard error messages to parent-friendly copy. The deposit-lock
 *  guard's message is already human-written and passes through unchanged. */
function friendlySaveError(message?: string): string {
  if (!message) return "Could not save.";
  if (message.includes("children_academics_shape")) {
    return "One of the academics answers is too long — try shortening it.";
  }
  if (message.includes("children_group_slug_allowed")) {
    return "That group choice isn't valid.";
  }
  return message;
}

/* ---------- provider ---------- */

export default function DashboardProvider({ children: reactChildren }: { children: React.ReactNode }) {
  const supabaseRef = useRef(supabaseBrowser());
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [parent, setParent] = useState<Parent | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const childrenRef = useRef<Child[]>([]);
  /** Per-child promise chains: at most one in-flight write per child, and a
   *  later write always executes after (and with newer state than) an earlier
   *  one — no stale debounce can overwrite an explicit save. */
  const writeChains = useRef<Map<string, Promise<unknown>>>(new Map());
  /** Tombstones: ids removed locally; chained writes no-op for these so an
   *  in-flight upsert can never resurrect a just-deleted child. */
  const deletedIds = useRef<Set<string>>(new Set());

  /** Single write path for children state: the ref is the always-fresh source
   *  and the React state mirrors it (kept in lockstep here, nowhere else). */
  const applyChildren = useCallback((next: Child[]) => {
    childrenRef.current = next;
    setChildren(next);
  }, []);

  const loadFamily = useCallback(async (activeSession: Session) => {
    const supabase = supabaseRef.current;
    const user = activeSession.user;
    const [parentRes, { data: childRows }, { data: depositRows }] = await Promise.all([
      supabase.from("parents").select("first_name,last_name,email").eq("id", user.id).maybeSingle(),
      supabase.from("children").select("*").order("created_at"),
      supabase.from("deposits").select("child_id,status"),
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
    applyChildren(((childRows as ChildRow[]) ?? []).map(rowToChild));
    setDeposits(
      ((depositRows as { child_id: string; status: string }[]) ?? []).map((d) => ({
        childId: d.child_id,
        status: d.status,
      }))
    );
  }, [applyChildren]);

  useEffect(() => {
    const supabase = supabaseRef.current;
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
        applyChildren([]);
        setDeposits([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFamily, applyChildren]);

  /**
   * Enqueue one child's upsert onto its per-child write chain. The row
   * snapshot is read from `childrenRef` at the moment the chained write
   * EXECUTES (not at enqueue time), so a queued write always carries the
   * newest state; tombstoned ids no-op. The returned promise never rejects,
   * keeping the chain healthy for the next write.
   */
  const enqueueWrite = useCallback(
    (id: string, opts?: { includeStatus?: boolean }): Promise<{ ok: boolean; error?: string }> => {
      const chains = writeChains.current;
      const prev = chains.get(id) ?? Promise.resolve();
      const next = prev.then(async (): Promise<{ ok: boolean; error?: string }> => {
        if (deletedIds.current.has(id)) return { ok: true };
        const current = childrenRef.current.find((c) => c.id === id);
        if (!current) return { ok: false, error: "Child not found" };
        try {
          const {
            data: { user },
          } = await supabaseRef.current.auth.getUser();
          if (!user) return { ok: false, error: "Not signed in" };
          if (opts?.includeStatus) {
            // Submit path: verify the DB's status echo. The status guard
            // COERCES (never raises) non-service-role writes — if this upsert
            // landed as the row's first-ever INSERT the guard silently keeps
            // 'draft' while the write reports success, and the family would
            // believe they applied while staff never see them. Surface that
            // as a retryable failure instead (the retry is an UPDATE, which
            // the guard permits for draft → submitted).
            const { data, error } = await supabaseRef.current
              .from("children")
              .upsert(childToRow(current, user.id, opts))
              .select("status")
              .single();
            if (error) {
              console.error("[dashboard] save failed:", error.message);
              return { ok: false, error: error.message };
            }
            if ((data as { status: string } | null)?.status !== current.status) {
              return { ok: false, error: "The submission didn't go through" };
            }
            return { ok: true };
          }
          const { error } = await supabaseRef.current
            .from("children")
            .upsert(childToRow(current, user.id, opts));
          if (error) {
            console.error("[dashboard] save failed:", error.message);
            return { ok: false, error: error.message };
          }
          return { ok: true };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not save.";
          console.error("[dashboard] save failed:", message);
          return { ok: false, error: message };
        }
      });
      chains.set(id, next);
      return next;
    },
    []
  );

  /** Persist one child row soon (fire-and-forget; RLS scopes to this parent). */
  const persistChild = useCallback(
    (id: string) => {
      void enqueueWrite(id);
    },
    [enqueueWrite]
  );

  /** Explicit awaited save (wizard Next/Submit): flush any pending debounce
   *  for this child and enqueue the write now, so the caller can gate on the
   *  result. `includeStatus` (submit only) adds status + submitted_at. */
  const saveChildNow = useCallback(
    async (
      id: string,
      opts?: { includeStatus?: boolean }
    ): Promise<{ ok: boolean; error?: string }> => {
      const timers = saveTimers.current;
      const pending = timers.get(id);
      if (pending) {
        clearTimeout(pending);
        timers.delete(id);
      }
      const res = await enqueueWrite(id, opts);
      return res.ok ? res : { ok: false, error: friendlySaveError(res.error) };
    },
    [enqueueWrite]
  );

  const schedulePersist = useCallback(
    (id: string) => {
      const timers = saveTimers.current;
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          persistChild(id);
        }, 700)
      );
    },
    [persistChild]
  );

  const addChild = () => {
    const id = crypto.randomUUID();
    applyChildren([...childrenRef.current, emptyChild(id)]);
    // Create the row immediately so it exists even if the parent types nothing
    // (the ref is already fresh, so the write sees the new child).
    persistChild(id);
    return id;
  };

  const updateChild = (id: string, patch: Partial<Child>) => {
    applyChildren(childrenRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    schedulePersist(id);
  };

  const removeChild = (id: string) => {
    deletedIds.current.add(id);
    applyChildren(childrenRef.current.filter((c) => c.id !== id));
    const timers = saveTimers.current;
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    // Chain the delete behind any in-flight upsert for this child so the
    // upsert can't land after (and undo) the delete; queued-but-unstarted
    // writes no-op on the tombstone.
    const chains = writeChains.current;
    const prev = chains.get(id) ?? Promise.resolve();
    chains.set(
      id,
      prev.then(async () => {
        const { error } = await supabaseRef.current.from("children").delete().eq("id", id);
        if (error) console.error("[dashboard] delete failed:", error.message);
      })
    );
  };

  const refreshDeposits = useCallback(async () => {
    const { data } = await supabaseRef.current.from("deposits").select("child_id,status");
    setDeposits(
      ((data as { child_id: string; status: string }[]) ?? []).map((d) => ({
        childId: d.child_id,
        status: d.status,
      }))
    );
  }, []);

  const signOut = () => {
    supabaseRef.current.auth.signOut();
  };

  return (
    <DashboardContext.Provider
      value={{
        ready,
        session,
        parent,
        children,
        deposits,
        addChild,
        updateChild,
        removeChild,
        saveChildNow,
        refreshDeposits,
        signOut,
      }}
    >
      {reactChildren}
    </DashboardContext.Provider>
  );
}
