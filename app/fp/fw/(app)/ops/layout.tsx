import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import FwOpsTabRow from "@/app/fp/fw/components/FwOpsTabRow";
import { resolveFwStaffGate } from "@/app/fp/lib/fw-auth";

/**
 * The staff ops shell — chrome for the surfaces guides never see. The chrome
 * itself is `FwOpsTabRow` (ops redesign Unit 1): the sticky pill row carrying
 * Weekends / Guide view / the ADMIN chip / the archived toggle / the + control,
 * and with it the `--staff-bar-h` sticky-offset contract that used to live in
 * this file's header markup.
 *
 * Deliberately NOT nested under `cohort/[cohortId]/layout.tsx`. That shell is
 * the GUIDE's working header (weekend name, switcher, sign out) and is scoped to
 * one cohort; ops spans cohorts, and half of it (creating a weekend) has no
 * cohort at all. Nesting would force a cohort into the URL of a page that does
 * not have one.
 *
 * THE GATE HERE IS THE COHORT-FREE ONE. `resolveFwStaffGate` asks the bridge's
 * two questions — admin claim AND a live, active staff row — without needing a
 * cohort to resolve against, which is exactly right for a subtree whose entry
 * point is "list every weekend". Per-cohort ops pages gate AGAIN on
 * `isFwStaffActor` for their own cohort, and every action re-gates server-side:
 * this layout is not load-bearing for authorization, because Next 16 layouts do
 * not re-render on navigation.
 *
 * `notFound()` rather than a message, matching the cohort layout: telling a
 * signed-in guide "this is staff-only" confirms the surface exists and is worth
 * probing. To a guide, /fp/fw/ops simply is not a page.
 *
 * NO SIGN-OUT HERE ANY MORE (Staff Front Door Unit 4, R16). This header used to
 * carry a bare `<form action={signOutFwGuide}>` — no verdict, no drain, no evidence
 * gate, no atomic clear — sitting inside the same `(app)` layout, for the same
 * actor, as the drain-gated control one level down. A guide who is also staff could
 * capture check-ins in the cohort view and then abandon the queue from here. The
 * persistent staff bar in `../layout.tsx` is the single control now, and the action
 * itself is deleted rather than merely unlinked: a `"use server"` export stays
 * POST-addressable whether or not anything renders a form for it.
 */
export default async function FwOpsLayout({ children }: { children: ReactNode }) {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) notFound();

  return (
    <>
      <FwOpsTabRow />
      {children}
    </>
  );
}
