import type { DashboardState, Parent } from "./data";

/**
 * V1 persistence: localStorage. Guarded for SSR.
 * Swap these four functions for Supabase queries in V2 — call sites don't change.
 */

const KEY = "the120.dashboard.v1";

const EMPTY: DashboardState = { parent: null, children: [] };

export function loadState(): DashboardState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as DashboardState;
    return { parent: parsed.parent ?? null, children: parsed.children ?? [] };
  } catch {
    return EMPTY;
  }
}

export function saveState(state: DashboardState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — non-fatal for V1 */
  }
}

/** Used by the account modal so a new account lands signed-in on the dashboard. */
export function saveParent(parent: Parent) {
  const state = loadState();
  saveState({ ...state, parent });
}
