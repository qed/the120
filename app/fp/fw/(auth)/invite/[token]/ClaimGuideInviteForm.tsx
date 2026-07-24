"use client";

/**
 * The guide credential claim form (FW Unit 2, Decision 12). One mode: the guide
 * sets the first password on the dormant account staff minted for them, and the
 * action signs them straight in on success.
 *
 * try/catch/finally per the frozen-modal learning — the busy flag must clear on
 * every exit path, including an action REJECTION on venue wifi.
 *
 * Error copy comes from the server verbatim: the dead-link message is one string
 * for all three refusals (never issued / already claimed / expired), because
 * distinguishing them would tell an unauthenticated visitor whether a token ever
 * existed.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { claimGuideInviteAction } from "@/app/fp/lib/actions/fw-guide";

export default function ClaimGuideInviteForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await claimGuideInviteAction({ token, password });
      if (result.success) {
        router.push("/fp/fw");
        router.refresh();
        return; // finally still clears busy
      }
      setError(result.error);
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
      {email && (
        <p className="rounded-lg border border-hq-border bg-hq-sunken px-3 py-2 font-path-body text-xs text-hq-ink">
          {email}
        </p>
      )}

      <label className="block" htmlFor="fw-invite-password">
        <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Choose a password
        </span>
        <input
          id="fw-invite-password"
          type="password"
          className="h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3.5 font-path-body text-sm text-hq-ink outline-none placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="A few unrelated words work well"
          autoComplete="new-password"
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

      <Button type="submit" skin="hq" size="lg" className="w-full" disabled={busy}>
        {busy ? "Setting your password…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
