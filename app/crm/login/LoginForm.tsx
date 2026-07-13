"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/client";

/**
 * Staff sign-in form (brief §3/§11): email + password only — no signup, no
 * reset, no OAuth. Generic error on ANY failure (never discloses whether the
 * account exists). On success, into the CRM.
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setFailed(true);
      setBusy(false);
      return;
    }
    router.push("/crm");
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
          <span className="text-[15px] font-bold tracking-[-0.02em] text-crm-ink">
            The 120
          </span>
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <h1 className="font-serif text-[22px] font-normal tracking-[-0.01em] text-crm-ink">
            Admissions
          </h1>
          <span className="rounded-full bg-crm-blush px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-crm-ink">
            STAFF ONLY
          </span>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block" htmlFor="crm-email">
            <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-crm-muted">
              Email
            </span>
            <input
              id="crm-email"
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="block" htmlFor="crm-password">
            <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-crm-muted">
              Password
            </span>
            <input
              id="crm-password"
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {failed && (
            <p
              role="alert"
              className="rounded-[10px] border border-crm-red bg-crm-red/5 p-3 text-xs leading-5 text-crm-red"
            >
              Sign-in failed
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-[10px] bg-crm-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white transition-all duration-200 hover:bg-red-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
