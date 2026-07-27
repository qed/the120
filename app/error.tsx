"use client";

/**
 * The ROOT error boundary (Staff Front Door Unit 5, B5).
 *
 * Before this, a genuine exception anywhere outside `/crm` and `/staff`'s own
 * boundaries surfaced as Next's generic framework error page — which offers no retry,
 * says nothing true about the cause, and looks to a guide at a live event exactly like
 * the app being broken.
 *
 * ⚠️ THIS IS THE BOUNDARY THAT CATCHES `app/staff/layout.tsx`. Next's `error.js` wraps
 * a segment's children but NOT the `layout.js` in its OWN segment, and `/staff` gates
 * in its layout — so `app/staff/error.tsx` cannot catch it and this one does. Do not
 * delete this on the grounds that the leaf routes have their own.
 *
 * NOT accompanied by a `global-error.tsx`. That one exists to catch throws from the
 * ROOT LAYOUT, and `app/layout.tsx` fetches nothing and gates nothing — it renders
 * fonts and chrome. Adding one would mean maintaining a second full `<html>` document
 * whose only trigger is a bug in static markup. If the root layout ever grows a data
 * read, that changes and this note is the tripwire.
 */

import { IdentityUnavailable } from "@/app/lib/staff-bar/IdentityUnavailable";

export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <IdentityUnavailable error={error} retry={unstable_retry} />;
}
