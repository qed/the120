"use client";

import { useState } from "react";
import { setParentPasswordAction } from "@/app/lib/v3-signup/actions/set-password";

/**
 * The converted-funnel-parent password form (plan Unit 8). Layout only — every
 * decision (session, validation, the durable stamp) is the action's.
 *
 * Mobile-first: single column, 44px-tall controls, nothing that can overflow at
 * 390px.
 */
export function SetPasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await setParentPasswordAction({ password });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    // A full navigation, not a router push: the session's app_metadata changed,
    // and every server gate downstream re-reads it on a fresh request.
    window.location.href = next;
  };

  return (
    <form onSubmit={submit} className="w-full">
      <p className="eyebrow">One quick thing</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        Choose a password for your account.
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        Until now you have signed in with an emailed link. Pick a password and you can sign in
        any time, on any device.
      </p>

      <label
        htmlFor="new-parent-password"
        className="mt-6 block font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-soft"
      >
        New password
      </label>
      <input
        id="new-parent-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-2 h-12 w-full rounded-xl border border-line bg-white px-4 text-base text-ink outline-none focus:border-ink"
        required
      />
      {error && <p className="mt-3 text-sm leading-6 text-red">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
