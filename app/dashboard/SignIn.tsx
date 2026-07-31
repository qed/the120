"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { requestParentPasswordResetAction } from "@/app/lib/auth/actions/reset";
import { requestResumeLinkAction } from "@/app/lib/funnel/actions/resume";
import { RETURN_TO_PARAM, safeReturnTo } from "@/app/lib/funnel/return-to-rules";
import Cta from "@/app/components/Cta";
import Wordmark from "@/app/components/Wordmark";

/** S1: email + password sign-in for returning parents (with self-serve
 * password reset → /reset, and an email-me-a-link mode that rides the
 * funnel's hardened resume-link path). New families use the join modal. */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "reset" | "link">("signin");
  const [resetSent, setResetSent] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  // R12 (redirect-back half): the validated returnTo, read from the URL ONCE
  // at mount (lazy initializer — no setState-in-effect, the depositBanner
  // pattern). safeReturnTo is the ONLY admission gate: anything it rejects
  // (absolute URLs, //evil.com, dot segments, …) collapses to null, which
  // means exactly today's behavior — in-place dashboard swap, no navigation.
  // Deliberate scope: returnTo applies only to a sign-in COMPLETING in this
  // mount. An already-signed-in visitor landing on /dashboard?returnTo=…
  // (back button, stale link) never renders <SignIn/> at all — the store's
  // session gate shows the dashboard — so they are never yanked to /start.
  const [returnTo] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return safeReturnTo(new URLSearchParams(window.location.search).get(RETURN_TO_PARAM));
  });
  // Latch: the navigation fires at most once, even if a second submit lands
  // before the browser tears this page down.
  const navigatedRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Email or password doesn't match — try again."
          : /email not confirmed/i.test(error.message)
            ? "Confirm your email first — check your inbox for the link we sent."
            : error.message
      );
      setBusy(false);
      return; // failed sign-ins NEVER navigate
    }
    if (returnTo && !navigatedRef.current) {
      // Success with a validated returnTo: full navigation to the funnel
      // route (it's server-rendered — a client swap can't take us there).
      // The store's onAuthStateChange may swap the dashboard in during the
      // same tick; that's moot once assign() unloads the page, and `busy`
      // stays true so the form is inert either way.
      navigatedRef.current = true;
      window.location.assign(returnTo);
      return;
    }
    // On success (no returnTo) the store's onAuthStateChange swaps in the dashboard.
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // W12: server-side now, so the no-auth-mail guard is actually in the
    // path — this form used to call Supabase straight from the browser,
    // where nothing could stop a reset addressed to a student. Same copy
    // either way: no account enumeration.
    await requestParentPasswordResetAction(email).catch(() => {});
    setResetSent(true);
    setBusy(false);
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // U4: the funnel's request-a-link action is the whole mechanism — its
    // response body, its resolution, and its rate buckets are constant
    // whether or not the address has an application, so this handler must
    // not branch on anything except the promise settling.
    try {
      const { message } = await requestResumeLinkAction({ email });
      setLinkMessage(message);
      setLinkSent(true);
    } catch {
      setError("That didn't go through. Give it a moment and try again.");
    }
    setBusy(false);
  };

  const inputCls =
    "h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-sm text-ink outline-none transition-all duration-150 placeholder:text-muted focus:border-red focus:ring-4 focus:ring-red/10";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <Link href="/" aria-label="The 120 home">
        <Wordmark />
      </Link>

      <div className="mt-8 w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-[0_2px_14px_rgba(19,20,22,0.06)] sm:p-10">
        <p className="eyebrow">Parent dashboard</p>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">Sign in</h1>

        {mode === "signin" ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                Email
              </span>
              <input
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                Password
              </span>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error && (
              <p className="rounded-xl border border-red bg-red/5 p-3 text-xs leading-5 text-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("reset");
                setResetSent(false);
                setError(null);
              }}
              className="block w-full text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
            >
              Forgot password?
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("link");
                setLinkSent(false);
                setLinkMessage(null);
                setError(null);
              }}
              className="block w-full text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
            >
              Email me a link to continue
            </button>
          </form>
        ) : mode === "reset" ? (
          <form className="mt-6 space-y-4" onSubmit={handleReset}>
            <p className="text-sm leading-6 text-ink-soft">
              Enter your email and we&rsquo;ll send a link to set a new password.
            </p>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                Email
              </span>
              <input
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {resetSent && (
              <p
                role="status"
                className="rounded-xl border border-line bg-paper-2 p-3 text-xs leading-5 text-ink"
              >
                If that address has an account, a reset link is on its way — check the inbox and
                follow the link.
              </p>
            )}

            <button
              type="submit"
              disabled={busy || resetSent}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Sending…" : resetSent ? "Link sent" : "Send reset link"}
            </button>

            <button
              type="button"
              onClick={() => setMode("signin")}
              className="block w-full text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
            >
              ← Back to sign-in
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleLink}>
            <p className="text-sm leading-6 text-ink-soft">
              No password needed. Enter your email and we&rsquo;ll send a link that picks up your
              application where it left off.
            </p>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                Email
              </span>
              <input
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {linkSent && linkMessage && (
              <p
                role="status"
                className="rounded-xl border border-line bg-paper-2 p-3 text-xs leading-5 text-ink"
              >
                {linkMessage}
              </p>
            )}

            {error && (
              <p className="rounded-xl border border-red bg-red/5 p-3 text-xs leading-5 text-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || linkSent}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Sending…" : linkSent ? "Link sent" : "Email me a link"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
              className="block w-full text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
            >
              ← Back to sign-in
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-line pt-5 text-center">
          <p className="text-sm text-ink-soft">New to The 120?</p>
          <div className="mt-3 flex justify-center">
            {/* 2026-07-30 (item 39): creating an account IS starting the
                application — straight to step 1 of the unified flow, never
                the account modal. */}
            <Cta href="/start" className="px-7 py-3.5 text-sm">
              Create an account
            </Cta>
          </div>
        </div>
      </div>

      <Link
        href="/"
        className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
      >
        ← Back to the site
      </Link>
    </div>
  );
}
