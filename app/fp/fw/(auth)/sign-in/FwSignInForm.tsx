"use client";

import { useState } from "react";
import { Button } from "@/app/fp/fw/components/system/Button";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import { signInGuide } from "@/app/lib/fp/actions/fw-guide";
import { isNextRedirect } from "@/app/lib/fp/next-redirect";

/**
 * The guide door's form (FW Unit 2) — email + password, one door, no tabs.
 *
 * try/catch/finally per the repo's frozen-modal learning (docs/solutions/
 * ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-…): an
 * action can REJECT rather than return {success:false}, and on a venue wifi
 * that is the likely shape. The busy flag must clear on every exit path or the
 * guide is holding a dead iPad in front of a queue.
 *
 * Error copy comes from the server verbatim — deliberately generic there (no
 * account enumeration), so nothing is added or specialized here.
 */
export default function FwSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signInGuide({ email, password });
      // Only a refusal ever RESOLVES: on success the action redirects to
      // /fp/fw, so this promise REJECTS with NEXT_REDIRECT (handled below)
      // while the router navigates on session freshly set by the action.
      if (!result.success) setError(result.error);
    } catch (e) {
      // The action's redirect surfaces here as a NEXT_REDIRECT rejection the
      // router is already acting on — let it pass, never paint it as failure.
      if (isNextRedirect(e)) return; // finally still clears busy
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3.5 font-path-body text-sm text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      <label className="block" htmlFor="fw-email">
        <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Your email
        </span>
        <input
          id="fw-email"
          type="email"
          className={inputCls}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          spellCheck={false}
          required
        />
      </label>

      <label className="block" htmlFor="fw-password">
        <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Your password
        </span>
        <input
          id="fw-password"
          type="password"
          className={inputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        skin="hq"
        size="lg"
        className="w-full"
        disabled={busy}
        icon={<Icon name="arrow-right" size={18} />}
      >
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
