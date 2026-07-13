import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { getSeatsRemaining } from "@/app/lib/seats";
import CrmChrome from "@/app/crm/components/CrmChrome";

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
 */
export default async function CrmAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await requireStaff();
  const seatsRemaining = await getSeatsRemaining();

  return (
    <div className="flex min-h-screen flex-col bg-crm-bg text-crm-ink">
      <CrmChrome seatsRemaining={seatsRemaining} email={staff.email} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
