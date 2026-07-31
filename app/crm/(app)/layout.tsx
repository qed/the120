import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { getSeatsRemaining } from "@/app/lib/seats";
import CrmChrome from "@/app/crm/components/CrmChrome";
import ToastProvider from "@/app/crm/components/Toast";
import { StaffBar } from "@/app/lib/staff-bar/StaffBar";

export const metadata: Metadata = {
  title: "Admissions — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * Guarded route group (plan Unit 3): every CRM screen lives under
 * `app/crm/(app)/` and renders inside this chrome. `/crm/login` and
 * `/crm/staff-only` sit outside the group so the guard can't lock the door
 * to the door. Pages still call `requireStaff()` themselves — layouts don't
 * re-run on soft navigation between children.
 *
 * THE STAFF BAR MOUNTS HERE (Staff Front Door Unit 4, R15) — the outermost guarded
 * CRM layout, and the reason `/crm/login`, `/crm/reset` and `/crm/staff-only` get no
 * bar without anyone writing a rule about them: they sit outside this route group.
 * It carries identity and sign-out, which `CrmTabs` used to. The six section tabs
 * stay where they are (R24): they are the CRM's navigation, not the bar's, and the
 * tab row already meets its survive-at-375px contract only by scrolling.
 */
export default async function CrmAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await requireStaff();
  const seatsRemaining = await getSeatsRemaining();

  // ToastProvider mounts here (not per-screen) so every CRM surface —
  // pipeline now, dossiers/dashboard/library in Units 5–7 — shares one
  // bottom-right toast stack (plan Unit 4 shared primitive).
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-crm-bg text-crm-ink">
        {/* Item 40 (2026-07-30): ONE floating blue backend nav — the home
            nav's floating-card geometry, the CRM's blue, both former bars
            (staff identity row + CRM band + tabs) combined inside it. */}
        <div className="sticky top-[18px] z-40 mx-5 mt-[18px] print:hidden">
          <div className="overflow-hidden rounded-[14px] bg-crm-blue shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
            <StaffBar application="crm" actorUserId={staff.staffId} />
            <CrmChrome seatsRemaining={seatsRemaining} />
          </div>
        </div>
        <main className="flex-1">{children}</main>
      </div>
    </ToastProvider>
  );
}
