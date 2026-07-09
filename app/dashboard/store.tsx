"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { type Child, type Parent, emptyChild } from "./data";

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
  submitChild: (id: string) => void;
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

type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  grade: number | null;
  birth_year: string;
  current_school: string;
  photo: string | null;
  subjects: string[];
  test_scores: string;
  workshop_ids: string[];
  interests: string;
  project_pitch: string;
  portfolio_links: string;
  status: Child["status"];
  submitted_at: string | null;
};

function rowToChild(r: ChildRow): Child {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    grade: r.grade ?? "",
    birthYear: r.birth_year,
    currentSchool: r.current_school,
    photo: r.photo ?? undefined,
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

function childToRow(c: Child, parentId: string) {
  return {
    id: c.id,
    parent_id: parentId,
    first_name: c.firstName,
    last_name: c.lastName,
    grade: c.grade === "" ? null : c.grade,
    birth_year: c.birthYear,
    current_school: c.currentSchool,
    photo: c.photo ?? null,
    subjects: c.subjects,
    test_scores: c.testScores,
    workshop_ids: c.workshopIds,
    interests: c.interests,
    project_pitch: c.projectPitch,
    portfolio_links: c.portfolioLinks,
    status: c.status,
    submitted_at: c.submittedAt ?? null,
    updated_at: new Date().toISOString(),
  };
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
  childrenRef.current = children;

  const loadFamily = useCallback(async (userId: string) => {
    const supabase = supabaseRef.current;
    const [{ data: parentRow }, { data: childRows }, { data: depositRows }] = await Promise.all([
      supabase.from("parents").select("first_name,last_name,email").eq("id", userId).maybeSingle(),
      supabase.from("children").select("*").order("created_at"),
      supabase.from("deposits").select("child_id,status"),
    ]);
    setParent(
      parentRow
        ? { firstName: parentRow.first_name, lastName: parentRow.last_name, email: parentRow.email }
        : null
    );
    setChildren(((childRows as ChildRow[]) ?? []).map(rowToChild));
    setDeposits(
      ((depositRows as { child_id: string; status: string }[]) ?? []).map((d) => ({
        childId: d.child_id,
        status: d.status,
      }))
    );
  }, []);

  useEffect(() => {
    const supabase = supabaseRef.current;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) await loadFamily(session.user.id);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) await loadFamily(newSession.user.id);
      else {
        setParent(null);
        setChildren([]);
        setDeposits([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFamily]);

  /** Persist one child row now (fire-and-forget; RLS scopes to this parent). */
  const persistChild = useCallback((id: string) => {
    const current = childrenRef.current.find((c) => c.id === id);
    if (!current) return;
    supabaseRef.current.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabaseRef.current
        .from("children")
        .upsert(childToRow(current, user.id))
        .then(({ error }) => {
          if (error) console.error("[dashboard] save failed:", error.message);
        });
    });
  }, []);

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
    setChildren((cs) => [...cs, emptyChild(id)]);
    // Create the row immediately so it exists even if the parent types nothing.
    setTimeout(() => persistChild(id), 0);
    return id;
  };

  const updateChild = (id: string, patch: Partial<Child>) => {
    setChildren((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    schedulePersist(id);
  };

  const removeChild = (id: string) => {
    setChildren((cs) => cs.filter((c) => c.id !== id));
    const timer = saveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    supabaseRef.current
      .from("children")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("[dashboard] delete failed:", error.message);
      });
  };

  const submitChild = (id: string) => {
    setChildren((cs) =>
      cs.map((c) =>
        c.id === id ? { ...c, status: "submitted", submittedAt: new Date().toISOString() } : c
      )
    );
    setTimeout(() => persistChild(id), 0);
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
        submitChild,
        refreshDeposits,
        signOut,
      }}
    >
      {reactChildren}
    </DashboardContext.Provider>
  );
}
