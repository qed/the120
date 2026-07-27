"use client";

/**
 * The shared body of every `error.tsx` this repo has (Staff Front Door Unit 5, B5).
 *
 * LIVES IN `app/lib/`, not beside the staff bar: the ROOT boundary renders it on
 * pages that have nothing to do with staff chrome (maintainability review).
 *
 * DELIBERATELY THIN, for the reason `StaffBar.tsx` is: `environment: "node"` with no
 * jsdom means anything decided in a `.tsx` is invisible to CI. The words live in
 * `identityUnavailableCopy()` — pure, exported, tested — and this renders them.
 *
 * ── Why the copy does not vary by cause
 *
 * Next serializes only `digest` to the client in production; `error.message` is
 * replaced with a generic string precisely so server details do not leak. So a
 * boundary CANNOT reliably branch on what threw, and one that appeared to would be
 * telling the truth in development and something else in production. It says one
 * honest thing for every cause. The cause lives in the server log, joinable by
 * `digest`.
 *
 * ── Why `unstable_retry` and not `reset`
 *
 * They are different operations and only one of them is the fix. `reset()` clears the
 * error state and re-renders the SAME payload; `unstable_retry()` re-FETCHES and
 * re-renders the segment. Every error this boundary is here for — a timed-out
 * `getUser()`, an unreadable `staff` row — is resolved only by asking the server
 * again, so `reset()` would render a "Try again" button that cannot try anything and
 * lands the user right back here. `unstable_retry` was added in Next 16.2.0; this repo
 * is on 16.2.10. Verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */

import { useEffect, useRef, useState } from "react";
import { generalErrorCopy, identityUnavailableCopy } from "@/app/lib/identity-unavailable";

export function IdentityUnavailable({
  error,
  retry,
  /** Extra classes for the surface's own skin. The boundaries are the LAST thing that
   *  should fail to render, so this takes plain strings and nothing computed. */
  className = "",
  /**
   * Which sentences to show. "identity" asserts "you are still signed in", which is
   * only true where the audience is behind a gate by construction (/crm; the /staff
   * page segment). The ROOT boundary — which also catches anonymous visitors on
   * public pages — takes "general", which claims nothing about a session (security
   * review). The variant is chosen by WHICH FILE mounts this, a build-time fact,
   * because Next replaces `error.message` in production and the cause cannot be
   * branched on at runtime.
   */
  variant,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  className?: string;
  variant: "identity" | "general";
}) {
  const copy = variant === "identity" ? identityUnavailableCopy() : generalErrorCopy();
  // A brief post-tap disable. `unstable_retry()` re-fetches the whole segment (2+
  // Supabase round trips through the gate), and this button appears precisely when
  // the backend is degraded — rapid-tapping from every affected iPad at once is a
  // small thundering herd aimed at the thing already down (adversarial review). Two
  // seconds is enough to stop the reflex without pretending to be a backoff policy.
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (coolTimer.current !== null) clearTimeout(coolTimer.current);
  }, []);
  const onRetry = () => {
    if (cooling) return;
    setCooling(true);
    coolTimer.current = setTimeout(() => setCooling(false), 2_000);
    retry();
  };

  useEffect(() => {
    // The digest is the only join key between what the user saw and the server log
    // that says why. Logging it client-side is what makes a support conversation
    // ("it says try again") resolvable.
    console.error("[boundary] identity unavailable:", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className={`mx-auto flex max-w-md flex-col gap-4 px-6 py-16 ${className}`}>
      <h1 className="text-lg font-semibold">{copy.title}</h1>
      <p className="text-sm opacity-80">{copy.body}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={cooling}
        className="self-start rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {copy.retry}
      </button>
    </main>
  );
}
