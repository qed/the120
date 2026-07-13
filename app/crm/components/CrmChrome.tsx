import Link from "next/link";
import { SEATS_TOTAL } from "@/app/lib/site";
import CrmTabs from "./CrmTabs";

/**
 * Persistent CRM chrome (brief §4/§11): the Admin.dc.html top bar grown up —
 * #0300ED band with logo chip, mono breadcrumb, blush STAFF ONLY pill, live
 * seat label — plus the slim tab row. Server component; seat count and the
 * signed-in email arrive as props from the guarded layout.
 */
export default function CrmChrome({
  seatsRemaining,
  email,
}: {
  seatsRemaining: number;
  email: string;
}) {
  const filled = SEATS_TOTAL - seatsRemaining;

  return (
    <header>
      <div className="flex flex-wrap items-center gap-4 bg-crm-blue px-5 py-3.5 sm:px-7">
        <Link href="/crm" className="flex items-center gap-2.5">
          <span className="bg-white px-2 py-[5px] text-[15px] font-bold leading-none tracking-[-0.04em] text-crm-blue">
            120
          </span>
          <span className="whitespace-nowrap text-[15px] font-bold tracking-[-0.02em] text-crm-card">
            The 120
          </span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-white/25 sm:block" />
        <span className="font-mono text-[11px] tracking-[0.12em] text-white/75">
          ADMISSIONS · CRM
        </span>
        <span className="rounded-full bg-crm-blush px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-crm-ink">
          STAFF ONLY
        </span>
        <span className="ml-auto whitespace-nowrap font-mono text-[10.5px] tracking-[0.06em] text-white/75">
          {filled} SEATS FILLED · {seatsRemaining} REMAIN
        </span>
      </div>

      <CrmTabs email={email} />
    </header>
  );
}
