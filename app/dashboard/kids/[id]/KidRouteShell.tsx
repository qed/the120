"use client";

/**
 * THE PER-KID ROUTE SHELL — the one implementation of "a page about ONE kid".
 *
 * Both per-kid routes (/dashboard/kids/<id>, the KID's apps launcher, and
 * /dashboard/kids/<id>/account, the PARENT's controls) used to carry their own
 * verbatim copy of the same six things: the store read, the client auth gate,
 * the ownership lookup, the page chrome, the back link, and the
 * loading / not-found / body three-way. Two copies of an ownership check is two
 * things to review and two things that can drift; this is one.
 *
 * ── OWNERSHIP / NOT FOUND (THE SECURITY CONTROL, NOT LAYOUT) ──
 * The client store loads `children` RLS-scoped (only the signed-in parent's
 * kids), so the child is picked by id FROM THE STORE — that lookup is what makes
 * a guessed or foreign child id resolve to nothing. If no child matches (a
 * stranger's id, or a bad one), we render a clean "Kid not found" state, the
 * caller's `body` is never invoked, and we never reach for any other family's
 * data. RLS already prevents loading another family's row; this is the UI
 * fallback on top of that. Preserved EXACTLY as both routes had it, and
 * deliberately not "improved" while being moved: same `ready && !session`
 * condition (not a bare `!session`, which would flash SignIn during load), same
 * `?? null`, same order — the loading branch wins over not-found, because a
 * still-loading family is also an empty one and an owner must never be told
 * their kid does not exist.
 *
 * ── WHAT THE CALLER CHOOSES ──
 * Only two things: the `surface` treatment and the body. `surface` is a closed
 * union rather than a className, so a third look cannot be invented by accident:
 * cream + grain is the KID's space, white is the PARENT's, and that distinction
 * is deliberate.
 *
 * ── A BODY MUST NOT CALL HOOKS (the rule, and why) ──
 * `body` is a render prop CALLED AS A PLAIN FUNCTION, from inside a conditional
 * branch of this component's render. So any hook a body called would run on THIS
 * component's fiber, at a hook position only reached on the child-found branch.
 * The day the child goes away under a mounted page — an RLS refetch, another tab
 * archiving the kid, a load race — the ternary skips the body, this fiber sees
 * fewer hooks than last render, and React throws: the WHOLE per-kid route
 * crashes for a real parent, not just the body. Neither body calls a hook today,
 * and `apps-launcher-pins.test.ts` fails the build if one ever starts.
 *   ESCAPE HATCH: if a body needs state, do not call the hook in the closure —
 * make it a REAL component and mount it as JSX (`<KidBody child={c} />`), so
 * React gives it its own fiber and unmounting it is a normal unmount. Such a
 * component must be defined at MODULE scope: one defined inside a render gets a
 * new function identity every render, so React treats it as a different type and
 * remounts its whole subtree (losing its state) on every parent render.
 *
 * ── THIS SHELL MUST STAY STATELESS (or key its state on childId) ──
 * One component TYPE now serves every kid in a parent's session. Next.js does
 * not remount a client tree just because a dynamic segment's value changed, so
 * navigating /kids/A -> /kids/B REUSES this fiber with a new `childId`. The
 * shell holds no state today, and that is what makes the swap safe. Any
 * `useState`/`useRef` added here MUST be reset when `childId` changes (key the
 * shell on it at the mount site, or derive rather than store) — otherwise kid
 * A's value is still on screen on kid B's page, which is a privacy failure, not
 * just a stale-render bug.
 *
 * Mobile-first: base is the ~390px phone. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { useDashboard } from "../../store";
import { ACCOUNT_MENU, AppHeader } from "../../ui";
import SignIn from "../../SignIn";
import { type Child } from "../../data";

/** Which audience the page belongs to. Closed on purpose (see the docblock). */
export type KidRouteSurface = "kid" | "parent";

const SURFACE_CLASS: Record<KidRouteSurface, string> = {
  kid: "v3-grain min-h-screen bg-v3-cream text-v3-ink",
  parent: "min-h-screen bg-white text-v3-ink",
};

export default function KidRouteShell({
  childId,
  surface,
  body,
}: {
  /** The child id from the route (`/dashboard/kids/<childId>[/account]`). */
  childId: string;
  /** Whose space this page is: the kid's (cream + grain) or the parent's (white). */
  surface: KidRouteSurface;
  /**
   * The page body, called ONLY with a child this parent actually owns.
   *
   * MUST NOT CALL HOOKS. It is invoked as a plain function inside a conditional
   * branch below, so its hooks would land on the SHELL's fiber and a
   * found -> not-found transition would crash the route. See the docblock's
   * "A BODY MUST NOT CALL HOOKS" section for the mechanism and the escape hatch.
   */
  body: (child: Child) => ReactNode;
}) {
  const { ready, session, children } = useDashboard();

  // Auth gate: signed out always shows the SignIn swap (client-side), exactly as
  // the parent dashboard does — the server gate computed "render" for a
  // session-less request too.
  if (ready && !session) return <SignIn />;

  const child = children.find((c) => c.id === childId) ?? null;

  return (
    <div className={SURFACE_CLASS[surface]}>
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12">
        <Link
          href="/dashboard"
          className="inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors hover:text-v3-profit-dark"
        >
          <span aria-hidden>&lsaquo;</span> All kids
        </Link>

        {!ready ? (
          <p className="mt-6 v3-label text-v3-stone">Loading...</p>
        ) : !child ? (
          <div className="mt-6 rounded-3xl border border-dashed border-v3-ink/20 bg-white p-10 text-center">
            <h1 className="font-path-display text-3xl font-black text-v3-ink">Kid not found</h1>
            <p className="mt-3 text-base leading-relaxed text-v3-stone">
              We could not find that kid on your account.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark"
            >
              Back to all kids
            </Link>
          </div>
        ) : (
          body(child)
        )}
      </main>
    </div>
  );
}
