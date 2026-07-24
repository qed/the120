"use client";

import { useEffect } from "react";
import { Button } from "@/app/fp/components/system/Button";
import { Icon } from "@/app/fp/components/system/Icon";

/**
 * The FW subtree's error boundary (FW Unit 4, added by the reliability review).
 *
 * Every loader in `fw-loader.ts` returns a typed `{ok:false}` and every page has
 * hand-written "we couldn't load this just now" copy for it — but that discipline
 * only covers the `{data, error}` shape PostgREST returns IN BAND. A genuine
 * network abort THROWS, and a thrown error in a Server Component walks straight
 * past those branches and out of the render. Without a boundary here it lands on
 * Next's generic framework error page: a stack-shaped screen, in front of a guide
 * holding an iPad with a child waiting.
 *
 * Scoped to `/fp/fw` rather than the whole app because the audience is
 * specific: this copy tells a volunteer guide what to do (tap once, then find
 * staff), which is the wrong instruction everywhere else in the product.
 *
 * `reset()` re-renders the segment without a full reload — the cheapest recovery,
 * and the right first thing to try when the cause is one dropped request.
 */
export default function FwError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this screen to a server log line. A guide reading
    // it out over the phone is the realistic debugging channel at an event.
    console.error("[fw] surface error:", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10">
      <div className="rounded-xl border-2 border-not-yet bg-not-yet/10 p-5">
        <p className="flex items-center gap-2 font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          <Icon name="alert-triangle" size={16} className="text-not-yet" />
          Founders Weekend
        </p>
        <h1 className="mt-2 font-path-display text-xl font-semibold text-hq-ink">
          That didn&apos;t load.
        </h1>
        <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
          Nothing you tapped was lost. Try again — if it keeps happening, tell The 120 staff
          {error.digest ? ` and give them this code: ${error.digest}` : ""}.
        </p>
        <Button type="button" skin="hq" size="lg" className="mt-4 w-full" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
