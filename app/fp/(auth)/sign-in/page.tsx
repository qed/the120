import type { Metadata } from "next";
import SignInForm from "./SignInForm";

/**
 * The Path sign-in (T1 Unit 6) — the first rendered /path surface, and the one
 * route the proxy leaves unguarded (the door to the door). PRE-skin-selection
 * by definition: no student is known yet, so it renders in the grounded HQ
 * neutral treatment on the Path fonts (Unit 13's foundation), not in either
 * student skin. The handoff has no sign-in scene (its 20 surfaces start
 * post-auth), so the copy here is deliberately minimal and neutral — name,
 * password, and the one fact a locked-out child needs: a parent can reset it.
 *
 * Static by design: nothing here touches Supabase or env at render, so the
 * env-less build prerenders it safely. All auth work happens in the
 * signInStudent Server Action on submit.
 */

export const metadata: Metadata = {
  title: "Sign in — First Profit",
  robots: { index: false, follow: false },
};

export default function PathSignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          The 120
        </p>
        <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          First Profit
        </h1>
        <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
          Sign in with your name and your password.
        </p>
        <SignInForm />
      </div>
      <p className="mt-6 max-w-sm text-center font-path-body text-xs leading-5 text-hq-ink-muted">
        Lost your password? A parent can set a new one for you.
      </p>
    </main>
  );
}
