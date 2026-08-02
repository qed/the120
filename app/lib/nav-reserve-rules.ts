/**
 * Nav "Reserve a seat · $250" eligibility (nav-deposit-shortcut U4).
 *
 * PURE and display-only: the server gate is `canReserveSeatForChild` in the
 * checkout route — this predicate only decides whether the nav advertises
 * the shortcut (guard-with-no-callers lesson: a nav check is never the
 * mechanism). It deliberately re-derives nothing about status/applicant
 * ladders: the nav's question is coarser than the gate's — "is there
 * anything left to reserve?" — and a child the gate would refuse
 * (waitlisted) still routes to the dashboard, whose card explains why.
 *
 * The zero-children case SHOWS the CTA — that parent is exactly the
 * shortcut's audience (the dashboard's add-child empty state is the next
 * step). A naive `children.every(hasDeposit)` is vacuously true on the
 * empty set and would hide the CTA from its flagship user (the plan
 * review's trap, pinned below).
 *
 * `null` rows = not yet resolved → hidden, per the nav's no-flash
 * convention (default to the less-committal render; the CTA pops in once
 * facts exist, never out).
 */

export type NavChildRow = { id: string };
export type NavDepositRow = { child_id: string; status: string };

/** Paid or pending — "nothing left to secure" counts a clearing debit as
 *  secured (the server 409s a second payment during the window anyway). */
const covers = (status: string) => status === "paid" || status === "pending";

export function showReserveCta(
  children: readonly NavChildRow[] | null,
  deposits: readonly NavDepositRow[] | null
): boolean {
  if (children === null || deposits === null) return false; // unresolved: hidden
  if (children.length === 0) return true; // zero children: the CTA's audience
  const covered = new Set(deposits.filter((d) => covers(d.status)).map((d) => d.child_id));
  return !children.every((c) => covered.has(c.id));
}

/** One label, one destination — the nav renders exactly this. An internal
 *  link (never a funnel `src` marker: this is not a funnel entry). */
export const NAV_RESERVE_CTA = { label: "Reserve a seat · $250", href: "/dashboard" } as const;
