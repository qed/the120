import type { Metadata } from "next";
import FwSignInForm from "./FwSignInForm";

/**
 * /fp/fw/sign-in — the GUIDE door (FW Unit 2).
 *
 * A separate door from /fp/sign-in, and the proxy's `fw-login` outcome exists
 * to route to it: the Path door asks a child for their first name, and a guide
 * whose session expired at 9:05 on a Saturday would type an email into it, fail,
 * and be told that a parent can reset their password. Both doors are unguarded
 * (the door to the door), and this one is the only unguarded route under
 * /fp/fw besides the invite and board token subtrees.
 *
 * Deliberately NO "forgot password" affordance — Decision 12 makes staff-
 * re-issued invite links the only recovery path, and the reason is recorded in
 * docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-
 * mechanism-….md. The copy says so plainly so a locked-out guide's next move is
 * "find staff", not "hunt for a link that isn't there".
 *
 * Static by design: nothing here touches Supabase or env at render, so the
 * env-less build prerenders it safely. All auth work happens in the signInGuide
 * Server Action on submit.
 */

export const metadata: Metadata = {
  title: "Guide sign-in — Founders Weekend",
  robots: { index: false, follow: false },
};

export default function FwSignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          Founders Weekend
        </p>
        <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          Guide sign-in
        </h1>
        <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
          Use the email and password you set from your invite link.
        </p>
        <FwSignInForm />
      </div>
      <p className="mt-6 max-w-sm text-center font-path-body text-xs leading-5 text-hq-ink-muted">
        No password yet, or forgotten it? Ask The 120 staff to send you a fresh link — there&apos;s
        no self-service reset here.
      </p>
    </main>
  );
}
