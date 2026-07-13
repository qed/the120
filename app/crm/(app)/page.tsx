import { requireStaff } from "@/app/crm/lib/auth";

/**
 * Placeholder for the GTM Sprint Dashboard (plan Unit 6 replaces this) —
 * keeps the shell navigable while P1 ships. Empty state per brief §11 voice.
 */
export default async function CrmDashboardPage() {
  await requireStaff();

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-7 py-24 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
        GTM Sprint Dashboard
      </p>
      <h1 className="mt-3 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
        The Friday review will run from here.
      </h1>
      <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-crm-muted">
        GTM Sprint Dashboard — coming in P2. Until then, the pipeline and the
        dossier queue carry the week.
      </p>
    </div>
  );
}
