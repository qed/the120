import type { SeatsByGroupResult } from "@/app/crm/lib/gtm";

/**
 * Seats by group (brief §8 unit 5): five groups × committed/assigned from
 * `child_reviews.group_assignment` + member-review/paid-deposit truth, and
 * an "unassigned" bucket for committed kids without a group. No per-group
 * caps (decision 2026-07-13) — no warnings here.
 */

export default function SeatsByGroup({ data }: { data: SeatsByGroupResult }) {
  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card">
      <div className="border-b border-crm-line px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          Seats by group
        </p>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-crm-line font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
            <th className="px-5 py-2 font-normal sm:px-6">Group</th>
            <th className="px-3 py-2 text-right font-normal">Committed</th>
            <th className="px-5 py-2 text-right font-normal sm:px-6">Assigned</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.group} className="border-b border-crm-line">
              <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-crm-ink sm:px-6">
                {r.label}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] text-crm-ink">
                {r.committed}
              </td>
              <td className="px-5 py-2 text-right font-mono text-[11px] text-crm-ink sm:px-6">
                {r.assigned}
              </td>
            </tr>
          ))}
          <tr>
            <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-crm-muted sm:px-6">
              Unassigned
            </td>
            <td className="px-3 py-2 text-right font-mono text-[11px] text-crm-muted">
              {data.unassignedCommitted}
            </td>
            <td className="px-5 py-2 text-right font-mono text-[11px] text-crm-faint sm:px-6">
              —
            </td>
          </tr>
        </tbody>
      </table>

      <div className="border-t border-crm-line px-5 py-3 sm:px-6">
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
          COMMITTED = MEMBER REVIEW OR PAID DEPOSIT · ASSIGNED = GROUP CHIP SET
        </p>
      </div>
    </section>
  );
}
