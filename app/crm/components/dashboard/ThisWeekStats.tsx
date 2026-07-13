import type { ThisWeekStats as Stats } from "@/app/crm/lib/gtm";

/**
 * This-week stats strip (brief §8 unit 6): staff activity within the
 * selected week, counted from `crm_audit_log` rows — notes added, calls
 * logged, dossiers reviewed, families added.
 */

export default function ThisWeekStats({
  week,
  stats,
}: {
  week: number;
  stats: Stats;
}) {
  const items: { label: string; value: number }[] = [
    { label: "NOTES ADDED", value: stats.notesAdded },
    { label: "CALLS LOGGED", value: stats.callsLogged },
    { label: "DOSSIERS REVIEWED", value: stats.dossiersReviewed },
    { label: "FAMILIES ADDED", value: stats.familiesAdded },
  ];

  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card px-5 py-4 sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
        W{week} activity
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label}>
            <dd className="font-serif text-[24px] font-normal leading-none text-crm-ink">
              {item.value}
            </dd>
            <dt className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
              {item.label}
            </dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
