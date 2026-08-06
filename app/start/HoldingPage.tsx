/**
 * What an UNAUTHENTICATED visitor sees while `V3_START_LIVE` is off (plan Unit
 * 3's go-live lever). A Server Component with no interactivity: no form and no
 * action import, so this page renders no way to start a signup.
 *
 * ⚠ THAT IS NOT THE GATE, and an earlier version of this comment claimed it was
 * ("the gate is the absence of the flow"). It is false: a Server Action is a
 * separately-addressable POST endpoint whose id ships in any build where the
 * action module exists, so "this page imports no action" stops nobody from
 * POSTing to one. The REAL gate is the flag check at the top of each
 * unauthenticated-reachable action in app/start/actions.ts (review FIX 1);
 * this page is only the honest thing to SHOW while that gate is closed.
 *
 * The copy is honest and short. It does not promise a date (the flip is a
 * deployment promotion, not a schedule) and it gives an existing family a way
 * back in, because a returning parent who lands here during the window needs the
 * sign-in door, not an apology.
 */

import Link from "next/link";

export function HoldingPage() {
  return (
    <main className="v3-grain min-h-screen w-full bg-v3-cream text-v3-ink">
      <section className="mx-auto w-full max-w-xl px-5 py-16 sm:py-24">
        <p className="v3-label text-v3-one20">The 120 → First Profit</p>
        <h1 className="mt-3 font-path-display text-4xl leading-[1.05] font-black sm:text-5xl">
          Signups open shortly.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-v3-stone">
          We are getting the last pieces in place. Check back soon and your kid
          can start their first business in one sitting.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-ink px-6 py-3 font-path-display text-base font-semibold text-white transition-colors hover:bg-v3-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v3-ink"
          >
            I already have an account
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full px-6 py-3 font-path-display text-base font-semibold text-v3-ink ring-1 ring-v3-ink/20 ring-inset transition-colors hover:bg-v3-ink/5"
          >
            Back to The 120
          </Link>
        </div>
      </section>
    </main>
  );
}
