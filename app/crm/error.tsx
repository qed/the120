"use client";

/**
 * The `/crm` error boundary (Staff Front Door Unit 5, B5).
 *
 * This one DOES catch the gate. `requireStaff()` runs in `app/crm/(app)/layout.tsx`,
 * which is a nested segment below this file's own — and `error.js` wraps nested
 * layouts, excluding only the layout in its own segment (there is no
 * `app/crm/layout.tsx`). So an unreadable session or `staff` row anywhere under
 * `/crm`, in the layout or in any of the six pages, lands here with a retry.
 *
 * `/crm/login` and `/crm/staff-only` sit under this boundary too, which is correct:
 * they are the redirect targets, they do not gate, and an exception in either should
 * still offer a way forward rather than the framework's page.
 */

import { IdentityUnavailable } from "@/app/lib/IdentityUnavailable";

export default function CrmError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <IdentityUnavailable error={error} retry={unstable_retry} variant="identity" className="bg-crm-card text-crm-ink" />
  );
}
