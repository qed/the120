"use client";

/**
 * The `/staff` error boundary (Staff Front Door Unit 5, B5).
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT CATCH — stated because it is counter-intuitive and a
 * reviewer will (correctly) check it. Next's `error.js` wraps `page.js` and any nested
 * layouts BELOW it, but NOT the `layout.js` in its own segment. `app/staff/layout.tsx`
 * is where `requireStaff()` runs, so a throw from the gate does NOT land here — it
 * bubbles to `app/error.tsx`. What lands here is a throw from `app/staff/page.tsx`,
 * which gates again through the same memoized `requireStaff()` (deliberately: Next 16
 * layouts do not re-render on soft navigation).
 *
 * So the gate is covered on both renders, by two different boundaries, and both offer
 * the same retry. Verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 * ("It does not wrap the layout.js or template.js above it in the same segment").
 *
 * It is worth having anyway rather than leaning on the root: this one keeps the throw
 * scoped to the `/staff` subtree, so the segment retries alone.
 */

import { IdentityUnavailable } from "@/app/lib/staff-bar/IdentityUnavailable";

export default function StaffError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <IdentityUnavailable error={error} retry={unstable_retry} className="text-hq-ink" />;
}
