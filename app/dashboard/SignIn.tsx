"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import JoinButton from "@/app/components/JoinButton";
import Wordmark from "@/app/components/Wordmark";

/** S1: email + password sign-in for returning parents. New families use the join modal. */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    }
    // On success the store's onAuthStateChange swaps in the dashboard.
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
        </form>

        <div className="mt-6 border-t border-line pt-5 text-center">
          <p className="text-sm text-ink-soft">New to The 120?</p>
          <div className="mt-3 flex justify-center">
            <JoinButton className="px-7 py-3.5 text-sm">Create an account</JoinButton>
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
