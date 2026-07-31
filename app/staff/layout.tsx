import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { StaffBar } from "@/app/lib/staff-bar/StaffBar";

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
 * THE BAR MOUNTS HERE, and only here for this application (Unit 4, R15). `/staff`
 * has no nested guarded group, so this is trivially the outermost — but the rule it
 * follows is the same one that keeps a single bar on `/fp/fw/ops`: one mount per
 * application, in the outermost guarded layout. It takes the application and an
 * opaque actor id, and nothing else; identity and every role-derived branch resolve
 * client-side. `bar-wiring.test.ts` pins both the set of mounts and the props.
 */
export default async function StaffLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await requireStaff();

  return (
    <div className="min-h-screen bg-hq-canvas font-path-body text-hq-ink">
      {/* Item 40 (2026-07-30): ONE floating blue backend nav — the home
          nav's floating-card geometry with the CRM's blue skin, so staff
          know they've left the parent site. No marketing links here. */}
      <div className="sticky top-[18px] z-40 mx-5 mt-[18px] print:hidden">
        <div className="overflow-hidden rounded-[14px] bg-crm-blue shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
          <StaffBar application="staff" actorUserId={staff.staffId} />
        </div>
      </div>
      {children}
    </div>
  );
}
