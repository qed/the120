"use client";

/**
 * The shared body of every `error.tsx` this repo has (Staff Front Door Unit 5, B5).
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

import { useEffect } from "react";
import { identityUnavailableCopy } from "@/app/lib/identity-unavailable";

export function IdentityUnavailable({
  error,
  retry,
  /** Extra classes for the surface's own skin. The boundaries are the LAST thing that
   *  should fail to render, so this takes plain strings and nothing computed. */
  className = "",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  className?: string;
}) {
  const copy = identityUnavailableCopy();

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
        onClick={() => retry()}
        className="self-start rounded border px-4 py-2 text-sm font-medium"
      >
        {copy.retry}
      </button>
    </main>
  );
}
