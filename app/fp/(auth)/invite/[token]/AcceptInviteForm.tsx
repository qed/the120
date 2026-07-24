"use client";

/**
 * The invite acceptance form (T1 Unit 15). Two modes, decided server-side by
 * the landing page's pure verdict and re-verified by the action:
 *   - create_account: the invited adult sets a password (their address is
 *     proven by token possession); the action creates the account, grants,
 *     and signs them in.
 *   - accept_signed_in: a matching session just confirms.
 *
 * try/catch/finally + unwrapActionResult, per the parent-surface canon.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { unwrapActionResult } from "@/app/fp/lib/now-card-rules";
import { acceptInviteAction } from "@/app/fp/lib/actions/invite";

export default function AcceptInviteForm({
  token,
  mode,
  email,
}: {
  token: string;
  mode: "create_account" | "accept_signed_in";
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
      const result = unwrapActionResult(
        await acceptInviteAction(mode === "create_account" ? { token, password } : { token })
      );
      if (result.ok) {
        router.push("/fp/family");
        router.refresh();
        return;
      }
      setError(result.message ?? "Something went wrong — please try again.");
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
      <p className="rounded-lg border border-hq-border bg-hq-sunken px-3 py-2 font-path-body text-xs text-hq-ink">
        {email}
      </p>

      {mode === "create_account" && (
        <label className="block" htmlFor="invite-password">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Choose a password
          </span>
          <input
            id="invite-password"
            type="password"
            className="h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3.5 font-path-body text-sm text-hq-ink outline-none placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="A few unrelated words work well"
            autoComplete="new-password"
            required
          />
        </label>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      <Button type="submit" skin="hq" size="lg" className="w-full" disabled={busy}>
        {busy ? "Joining…" : "Join the family"}
      </Button>
    </form>
  );
}
