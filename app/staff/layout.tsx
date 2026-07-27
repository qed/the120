import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";

export const metadata: Metadata = {
  title: "Staff — The 120",
  // R5a: the hub declares itself unindexable. Without its own declaration it
  // inherits the PUBLIC marketing metadata from the root layout — the one
  // place in the repo where forgetting this indexes a staff surface rather
  // than merely leaving it undeclared.
  robots: { index: false, follow: false },
};

/**
 * `/staff` — the staff front door (Staff Front Door plan, Unit 2; R1, R5a, R6).
 *
 * The gate is defence in depth, and the two fences answer different questions:
 * `proxy.ts` asks signed-in-and-claims-admin from the JWT alone (cheap, no
 * round trip, and the only fence that can produce the in-place 404 REWRITE R6
 * asks for — a server component can only `redirect()`), while `requireStaff()`
 * verifies the session against the auth server AND the `staff` row's
 * `is_active`, so a revoked staff member with a stale JWT is refused here even
 * though the proxy passed them.
 *
 * The layout AND the page both gate, matching `app/crm/(app)/layout.tsx`:
 * Next 16 layouts do not re-render on soft navigation, so a page leaning on
 * its layout alone would be gated only on the render that mounted it.
 * `requireStaff()` is request-memoized, so the second call costs nothing.
 *
 * Unit 4 mounts the persistent staff bar here.
 */
export default async function StaffLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireStaff();

  return (
    <div className="min-h-screen bg-hq-canvas font-path-body text-hq-ink">
      {children}
    </div>
  );
}
