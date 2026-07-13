/**
 * Standing sync-health check (plan Unit 6): `count(parents)` −
 * `count(families with parent_id)`. Nonzero renders red — a silent
 * sync-trigger failure becomes a visible Friday-review fact (the backfill
 * script is the repair). Zero renders the green all-clear.
 */

export default function SyncHealth({
  parentCount,
  linkedFamilyCount,
}: {
  parentCount: number;
  linkedFamilyCount: number;
}) {
  const unsynced = parentCount - linkedFamilyCount;
  const healthy = unsynced === 0;

  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card px-5 py-4 sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
        Sync health
      </p>
      <p
        className="mt-3 font-serif text-[24px] font-normal leading-none"
        style={{ color: healthy ? "#0E8A5F" : "#D92632" }}
      >
        {healthy ? "0 UNSYNCED" : `${unsynced} UNSYNCED`}
      </p>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
        {healthy
          ? `ALL ${parentCount} PARENT ACCOUNTS HAVE A FAMILY ROW`
          : "PARENTS WITHOUT A FAMILY ROW — RUN scripts/backfill-families.ts"}
      </p>
    </section>
  );
}
