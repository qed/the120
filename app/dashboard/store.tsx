"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type Child, type DashboardState, type Parent, emptyChild } from "./data";
import { loadState, saveState } from "./storage";

type Store = {
  ready: boolean;
  parent: Parent | null;
  children: Child[];
  addChild: () => string;
  updateChild: (id: string, patch: Partial<Child>) => void;
  removeChild: (id: string) => void;
  submitChild: (id: string) => void;
  signOut: () => void;
};

const DashboardContext = createContext<Store | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within <DashboardProvider>");
  return ctx;
}

export default function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DashboardState>({ parent: null, children: [] });
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setState(loadState());
    setReady(true);
  }, []);

  // Persist after hydration.
  useEffect(() => {
    if (ready) saveState(state);
  }, [state, ready]);

  const addChild = () => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `child-${Date.now()}`;
    setState((s) => ({ ...s, children: [...s.children, emptyChild(id)] }));
    return id;
  };

  const updateChild = (id: string, patch: Partial<Child>) =>
    setState((s) => ({
      ...s,
      children: s.children.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const removeChild = (id: string) =>
    setState((s) => ({ ...s, children: s.children.filter((c) => c.id !== id) }));

  const submitChild = (id: string) =>
    setState((s) => ({
      ...s,
      children: s.children.map((c) =>
        c.id === id
          ? { ...c, status: "submitted", submittedAt: new Date().toISOString() }
          : c
      ),
    }));

  const signOut = () => setState((s) => ({ ...s, parent: null }));

  return (
    <DashboardContext.Provider
      value={{
        ready,
        parent: state.parent,
        children: state.children,
        addChild,
        updateChild,
        removeChild,
        submitChild,
        signOut,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
