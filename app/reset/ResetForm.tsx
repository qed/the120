"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import Wordmark from "@/app/components/Wordmark";

/**
 * Parent-facing password reset (site-branded twin of app/crm/reset): the
 * emailed recovery link lands here, the browser client exchanges the code
 * for a session, and the form sets the new password. Must be opened in the
 * same browser that requested the reset.
 */
export default function ResetForm() {
  const router = useRouter();
  const supabaseRef = useRef(supabaseBrowser());
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = supabaseRef.current;
    let settled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !settled) {
        settled = true;
        setSessionState("ready");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !settled) {
        settled = true;
        setSessionState("ready");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setSessionState("missing");
      }
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabaseRef.current.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1200);
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
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">
          Set a new password
        </h1>

        {sessionState === "checking" && (
          <p className="mt-4 text-sm leading-6 text-ink-soft">Checking your reset link…</p>
        )}

        {sessionState === "missing" && (
          <p className="mt-4 text-sm leading-6 text-ink-soft">
            This reset link is invalid, expired, or was opened in a different browser than the one
            that requested it. Head back to{" "}
            <Link href="/dashboard" className="text-red underline">
              sign-in
            </Link>{" "}
            and request a fresh one.
          </p>
        )}

        {sessionState === "ready" && done && (
          <p className="mt-4 text-sm leading-6 text-ink" role="status">
            Password set — taking you to your dashboard…
          </p>
        )}

        {sessionState === "ready" && !done && (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                New password
              </span>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                Repeat it
              </span>
              <input
                type="password"
                className={inputCls}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-red bg-red/5 p-3 text-xs leading-5 text-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
