import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { hasChosenPassword, isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";
import { familyHasFpChild } from "@/app/lib/funnel/session-rules";
import {
  needsSetPasswordStep,
  V3_ADD_KID_HREF,
} from "@/app/lib/v3-signup/remap-rules";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * `/set-password` — the one-time step the remap inserts for a CONVERTED FUNNEL
 * PARENT (plan Unit 8; see `needsSetPasswordStep`).
 *
 * ⚠ THE PAGE GATE IS NOT THE SECURITY CONTROL. It is a routing courtesy: it
 * sends a signed-out visitor to sign in and bounces a parent who does not need
 * the step, so nobody lands on a form that would do nothing. The control is in
 * `setParentPasswordAction`, which re-reads the session itself and can only ever
 * touch the caller's OWN account — a Server Action is a separately-addressable
 * POST endpoint and no page render stands in front of it (the page-vs-action
 * gating learning, 2026-08-05).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a password — The 120",
  description: "Set a password for your family account.",
};

export default async function SetPasswordPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No session: the dashboard renders SignIn. Never a form that cannot save.
  if (!user) redirect("/dashboard");

  // RLS scopes this to the caller's own family (`auth.uid() = parent_id`).
  const { data: childRows } = await supabase.from("children").select("fp_username");
  const children = (childRows ?? []).map((c) => ({
    fpUsername: typeof c.fp_username === "string" ? c.fp_username : null,
  }));

  const needed = needsSetPasswordStep({
    funnelStamped: isFunnelProvisioned(user.app_metadata),
    passwordChosen: hasChosenPassword(user.app_metadata),
    hasFpChild: familyHasFpChild(children),
  });
  // redirect() throws NEXT_REDIRECT by design and must stay OUTSIDE a try.
  if (!needed) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 py-16">
      {/* Where the step hands off to: the kid flow the family was heading for.
          A fixed first-party path, never a redirect parameter — an
          attacker-chosen destination on a just-authenticated page is an open
          redirect, and the v3 flow's own handoff carries a sign-in code. */}
      <SetPasswordForm next={V3_ADD_KID_HREF} />
    </main>
  );
}
