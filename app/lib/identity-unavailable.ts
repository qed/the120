/**
 * The THIRD answer an identity gate can give (Staff Front Door Unit 5, B4+B5).
 *
 * PLAIN module — no next/supabase/react imports — so both server gates
 * (`loadFwSessionRead` in `app/fp/lib/fw-auth.ts`, `requireStaff` in
 * `app/crm/lib/auth.ts`) and the node-only tests can share one definition.
 *
 * ── Why a third answer exists at all
 *
 * Before this unit both gates had exactly two: "here is who you are" and "you are
 * nobody". A Supabase call that timed out or threw collapsed into the second one,
 * and the second one is TERMINAL — `loadFwSession` returning null redirects a guide
 * to the sign-in door mid-Saturday, and `requireStaff` falling through to
 * `forbidden` tells an active staff member their account does not exist. Neither is
 * true. The truth is "we could not find out", and the correct response to it is to
 * ask again, not to act on a guess.
 *
 * That distinction is the whole of B4 and B5. Both gates now answer three ways, and
 * the third one is carried to the user as a retryable error boundary rather than as a
 * verdict about their account.
 *
 * ⚠️ THIS IS NOT A FAIL-OPEN. Throwing renders the error boundary INSTEAD of the
 * guarded subtree: no page body, no data, no staff-only affordance. A reader
 * checking whether Unit 5 weakened a security gate should check that property —
 * `identity-unavailable.test.ts` pins it as prose, and the gates' own tests pin that
 * nothing is returned on this path.
 */

/**
 * An identity read that did not answer — a timeout, or a throw from the client.
 *
 * A named class rather than a bare `Error` so a `catch` can tell "the gate could not
 * decide" apart from a genuine bug in the guarded subtree, WITHOUT matching on a
 * message string. Message matching is the shape this repo has already been bitten by
 * (a source scan satisfied by a comment); a class survives minification and rewording.
 *
 * NOT branded onto the error boundary's copy. Next serializes only `digest` to the
 * client in production — `error.message` is replaced — so `error.tsx` cannot and must
 * not branch on this. The boundary says one honest, retryable thing for every cause;
 * the server log line is where the cause lives.
 */
export class IdentityUnavailableError extends Error {
  /** Which gate could not answer, for the log line. */
  readonly gate: string;

  constructor(gate: string, detail: string) {
    super(`${gate} could not resolve identity: ${detail}`);
    this.name = "IdentityUnavailableError";
    this.gate = gate;
  }
}

export function isIdentityUnavailable(e: unknown): e is IdentityUnavailableError {
  return e instanceof IdentityUnavailableError;
}

/**
 * What an identity gate concluded — the three-way replacement for `T | null`.
 *
 * `unknown` is deliberately NOT nullable and NOT falsy-shaped: a caller that writes
 * `if (!read.session)` gets a type error rather than silently folding "we don't know"
 * back into "nobody", which is the exact collapse this type exists to prevent.
 */
export type IdentityRead<T> =
  | { kind: "identity"; identity: T }
  | { kind: "none" }
  | { kind: "unknown"; detail: string };

/**
 * The sentence every identity-unavailable boundary shows.
 *
 * Pure and exported because this repo runs `environment: "node"` with no jsdom, so
 * copy written inline in an `error.tsx` is untestable by construction — the headline
 * finding of three units running. The boundary components are thin wrappers over this.
 *
 * It must NOT say "you don't have access" (that is a verdict this path did not reach)
 * and must NOT say "try again in a moment" alone (the venue failure mode is a captive
 * portal, where waiting achieves nothing). It names the retry control, and the second
 * sentence names the other thing that actually works.
 */
export function identityUnavailableCopy(): { title: string; body: string; retry: string } {
  return {
    title: "We couldn't confirm your access just now",
    body:
      "This is a connection problem, not a problem with your account — you are still signed in. " +
      "Try again. If it keeps failing, check whether this device needs to sign in to the wi-fi.",
    retry: "Try again",
  };
}
