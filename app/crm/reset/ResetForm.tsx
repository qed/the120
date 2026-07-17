"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

/**
 * Sets a new password using the recovery session established by the emailed
 * reset link (the browser client exchanges the link's code on load). States:
 * waiting for the session → form → done; if no session materialises, the
 * link was invalid/expired/opened in a different browser than the one that
 * requested it — say so and point back to login.
 */
export default function ResetForm() {
  const router = useRouter();
  // Lazy: creating the client needs NEXT_PUBLIC_SUPABASE_* — deferred to the
  // browser so env-less builds can prerender this page (repo convention).
  const supabaseRef = useRef<ReturnType<typeof supabaseBrowser> | null>(null);
  const getSupabase = () => (supabaseRef.current ??= supabaseBrowser());
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
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

    // Give the code exchange a moment; then declare the link dead.
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
    const { error: updateError } = await getSupabase().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/crm"), 1200);
  };

  const inputCls =
    "h-12 w-full rounded-[10px] border border-crm-line2 bg-white px-3.5 text-sm text-crm-ink outline-none transition-all duration-150 placeholder:text-crm-faint focus:border-crm-blue focus:ring-4 focus:ring-crm-blue/10";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-crm-blue px-6">
      <div className="w-full max-w-sm rounded-xl bg-crm-card p-8 shadow-[0_4px_18px_rgba(19,20,22,0.14)] sm:p-10">
        <div className="flex items-center gap-2.5">
          <span className="bg-crm-blue px-2 py-[5px] text-[15px] font-bold leading-none tracking-[-0.04em] text-white">
            120
          </span>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-crm-ink">The 120</span>
        </div>

        <h1 className="mt-5 font-serif text-[22px] font-normal tracking-[-0.01em] text-crm-ink">
          Set a new password
        </h1>

        {sessionState === "checking" && (
          <p className="mt-4 text-sm leading-6 text-crm-muted">Checking your reset link…</p>
        )}

        {sessionState === "missing" && (
          <p className="mt-4 text-sm leading-6 text-crm-muted">
            This reset link is invalid, expired, or was opened in a different browser than the one
            that requested it. Go back to{" "}
            <a href="/crm/login" className="text-crm-blue underline">
              sign-in
            </a>{" "}
            and request a fresh one.
          </p>
        )}

        {sessionState === "ready" && done && (
          <p className="mt-4 text-sm leading-6 text-crm-ink" role="status">
            Password set — taking you in…
          </p>
        )}

        {sessionState === "ready" && !done && (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block" htmlFor="reset-password">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-crm-muted">
                New password
              </span>
              <input
                id="reset-password"
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
              />
            </label>
            <label className="block" htmlFor="reset-confirm">
              <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-crm-muted">
                Repeat it
              </span>
              <input
                id="reset-confirm"
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
              <p
                role="alert"
                className="rounded-[10px] border border-crm-red bg-crm-red/5 p-3 text-xs leading-5 text-crm-red"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-[10px] bg-crm-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
