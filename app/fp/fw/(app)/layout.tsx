import type { ReactNode } from "react";
import { FwPwa } from "@/app/fp/fw/components/FwPwa";
import { requireFwSession } from "@/app/fp/lib/fw-auth";
import { StaffBar } from "@/app/lib/staff-bar/StaffBar";

/**
 * The authed Founders Weekend shell (FW Unit 4).
 *
 * The `(app)` route group carries every guarded /fp/fw surface; `(auth)`
 * carries the unguarded guide door and invite landing. Both resolve to
 * /fp/fw/* URLs with no conflict.
 *
 * THE PERSISTENT STAFF BAR MOUNTS HERE (Staff Front Door Unit 4; R11, R15, R16).
 * This layout was deliberately chrome-less, and that is what the requirement
 * revisits: the header a guide works under — cohort name, switcher — lives one level
 * down in `cohort/[cohortId]/layout.tsx`, so a guide sitting on the multi-cohort
 * picker had no chrome at all and could not sign out from anywhere. The bar goes
 * HERE rather than in the two layouts below because both of them nest inside this
 * one; mounting it there too would stack two bars on `/fp/fw/ops` and on every
 * cohort surface. The cohort name is still not inferred here — the bar never names a
 * weekend, only the application.
 *
 * The two headers below now stack UNDER it: the bar publishes its own height as
 * `--staff-bar-h` and they offset by it, because both are `sticky` and two elements
 * claiming `top: 0` means the taller one simply covers the other.
 *
 * SIGN-OUT IS THE BAR'S, EXCLUSIVELY (R16). The ops header's bare
 * `<form action={signOutFwGuide}>` and the per-cohort `FwSignOutButton` are both
 * retired — the first had no verdict, drain, evidence gate or atomic clear at all,
 * so a guide could capture in the cohort view and abandon the queue from `/fp/fw/ops`
 * two clicks later. `bar-wiring.test.ts` asserts neither symbol survives anywhere.
 *
 * AUTH POSTURE (Next 16, inherited from the Path's `(app)` layout): layouts do
 * NOT re-render on navigation, so this gate is only the shell's identity
 * resolution — EVERY page in the group runs its own gate before any await that
 * could start streaming, and every ACTION re-gates server-side regardless.
 * `requireFwSession` answers signed-in-or-not; `resolveFwActorForCohort` answers
 * who, per cohort, at each page. Both are request-memoized, so the second call
 * on a render costs nothing.
 */
export default async function FwAppLayout({ children }: { children: ReactNode }) {
  const session = await requireFwSession();

  return (
    <div className="min-h-screen bg-hq-canvas font-path-body text-hq-ink">
      <StaffBar application="fw" actorUserId={session.userId} />
      {children}
      {/* Unit 8: SW registration + the offline drain engine + the queued indicator.
          Mounted HERE (the guide subtree) because the Path's PathPwa mounts only in
          the Path (app) layout, which guides never load. The drain scopes to this
          session's own captures — the author the same-actor guard reads.

          It no longer reconciles the device's cache owner — the bar above does, on
          every guarded staff surface rather than only this one (Unit 4). What stays
          is everything that CANNOT leave: the Background Sync effect awaits
          `navigator.serviceWorker.ready`, which off `/fp/fw` matches no registration
          and never settles, so mounting this globally would hang. */}
      <FwPwa actorUserId={session.userId} />
    </div>
  );
}
