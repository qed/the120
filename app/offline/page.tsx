import type { Metadata } from "next";

/**
 * The offline fallback page (T1 Unit 11) — the ONE route the service worker
 * precaches and serves when a /path navigation fails without a network.
 *
 * Lives OUTSIDE /path deliberately: the proxy gates /path/*, and a gated
 * fallback would cache a sign-in redirect at SW install time instead of this
 * page. Static, no auth, no Supabase, no client JS — it must render from the
 * SW cache on a cold offline start, and it must never break the env-less
 * build.
 *
 * The reassurance line is load-bearing product copy, not decoration: the
 * capture queue (offline-queue.ts) really does hold evidence on-device, and
 * the drain really does send it on the next signal. Say exactly that — no
 * promise beyond what the code does.
 */

export const metadata: Metadata = {
  title: "Offline — The Path",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-trail-canvas px-6 text-center">
      <div aria-hidden className="mb-6 flex items-end gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-phase-sell/40" />
        <span className="h-3 w-3 rounded-full bg-phase-sell/60" />
        <span className="h-3.5 w-3.5 rounded-full bg-phase-sell/80" />
        <span className="h-4 w-4 rounded-full bg-phase-sell" />
      </div>
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-trail-ink">
        You&rsquo;re offline
      </h1>
      <p className="mt-3 max-w-sm font-path-body text-[14px] leading-relaxed text-trail-ink/75">
        No signal out here — that&rsquo;s fine. Anything you captured is saved on
        this device, and it will send itself the moment you&rsquo;re back online.
      </p>
      <a
        href="/path"
        className="mt-6 rounded-xl bg-phase-sell px-5 py-2.5 font-path-body text-sm font-semibold text-white"
      >
        Try again
      </a>
    </main>
  );
}
