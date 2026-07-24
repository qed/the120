/**
 * Per-device FW surface memory (FW Unit 4; Decisions 3 and 14).
 *
 * PLAIN module, deliberately tiny and deliberately shared: the key names below
 * are read by one component and written by another, and a typo between the two
 * is a silent no-op that nobody notices until an event day. Unit 8's IndexedDB
 * queue and roster cache are a separate store family — this is only the two
 * scalar preferences that must survive a reload of the guide's iPad.
 *
 * `localStorage`, not a cookie: neither value is ever sent to the server (the
 * cohort stamp is carried explicitly in the URL and re-verified per request —
 * Decision 3 — so a persisted preference must never be able to influence what a
 * write is stamped with).
 */

/** The snapshot React uses during SSR and hydration — a sentinel distinct from
 *  "not set", so a reader can render nothing until it genuinely knows. */
export const FW_PREF_UNKNOWN = "__fw_pref_unknown__";

/** The last cohort picked on this device. LABELLED on the picker, never
 *  pre-selected — see `FwCohortPicker` for why that distinction is the point. */
export const FW_ACTIVE_COHORT_KEY = "fw.activeCohort";

/** Renamed from `FwCohortMemory`, which also names the component that WRITES it
 *  — one identifier meaning two different things depending on the import
 *  (maintainability review), in a file Unit 8 will add more preferences to. */
export type FwActiveCohort = { id: string; slug: string };

/**
 * Read the stored active cohort, or null.
 *
 * Here rather than inline in `FwCohortPicker` because a `JSON.parse` plus a
 * shape check is parsing logic, and parsing logic inside a component is
 * untestable in a repo with no jsdom — the same reason every other decision in
 * this unit lives in a plain module (testing review).
 *
 * Every failure is null: a corrupt value costs a label, nothing more. It must
 * never throw, because the picker that reads it is the screen a guide starts
 * their shift on.
 */
export function parseFwActiveCohort(raw: string | null): FwActiveCohort | null {
  if (raw === null || raw === FW_PREF_UNKNOWN) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { id, slug } = parsed as Record<string, unknown>;
    return typeof id === "string" && typeof slug === "string" ? { id, slug } : null;
  } catch {
    return null;
  }
}

/** Whether the FW reading rule banner has been dismissed on this device.
 *  Per-device and re-openable (Decision 14): a guide who dismisses it in the
 *  morning must be able to get it back when a done-when line surprises them. */
export const FW_READING_RULE_DISMISSED_KEY = "fw.readingRuleDismissed";

/**
 * The FW reading rule itself (FW-R15), in one place because it is quoted in the
 * banner and belongs in the spot-audit's own words too.
 *
 * The done-when lines were authored for home study, and some clauses are
 * literally unsatisfiable at a Founders Weekend: 1.2.3 wants "a parent playing
 * the buyer", 1.2.5 wants a photo "in the Founder File". FW has no parents in
 * the loop and no evidence capture. Without a stated rule, every guide improvises
 * privately and the Not-yet data starts measuring clause inapplicability instead
 * of task difficulty — which is the one thing FW-D4 needs it not to do.
 */
export const FW_READING_RULE = {
  title: "How to read the Done-when lines",
  clauses: [
    "Anywhere it says a parent — that's you.",
    "Anywhere it says the Founder File, a photo, or a record — you've seen it is enough.",
  ],
} as const;

/* ───────────────────────────────────── reading the store from React ──────── */

/**
 * A minimal `useSyncExternalStore` adapter over `localStorage`.
 *
 * The obvious shape — read in a `useEffect` and `setState` — is what React 19's
 * `react-hooks/set-state-in-effect` rule exists to stop, and it is also wrong
 * here for a concrete reason rather than a stylistic one: two components read
 * these keys and a third writes one, so a per-component effect gives each of
 * them a private copy of a value that another component can change. Subscribing
 * to the store means a write re-renders every reader.
 *
 * The server snapshot is a distinct SENTINEL rather than "not set". Returning
 * "not set" would render the reading-rule banner during SSR and then hide it a
 * frame later for a guide who dismissed it this morning — a flash on every
 * navigation for two days. `FW_PREF_UNKNOWN` lets a reader render nothing until
 * it genuinely knows.
 */
const listeners = new Set<() => void>();

export function subscribeFwPrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires only for OTHER tabs/windows; same-document writes notify
  // through `writeFwPref` below.
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

/** Current value, or null when unset/unreadable. Safe to call every render:
 *  `getItem` returns a primitive, so `Object.is` keeps the snapshot stable. */
export function readFwPref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode. These values are labels and preferences, never facts
    // anything depends on — losing them costs a chip, not a check-in.
    return null;
  }
}

/** The snapshot React uses during SSR and hydration. */
export function serverFwPref(): string {
  return FW_PREF_UNKNOWN;
}

export function writeFwPref(key: string, value: string | null): void {
  if (typeof window !== "undefined") {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* preference-only; never block the loop on it */
    }
  }
  for (const notify of [...listeners]) notify();
}
