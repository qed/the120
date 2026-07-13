import type { AmbassadorTallyRow, SourceTallyRow } from "@/app/crm/lib/gtm";

/**
 * Source & ambassador tally (brief §8 unit 5; folds in roadmap GTM-4):
 * leads + deposits by source, with the ambassador sub-table grouped by
 * AMB-* referral code — GTM §3's "weekly tally in the Friday review".
 */

export default function SourceTally({
  rows,
  ambassadors,
}: {
  rows: SourceTallyRow[];
  ambassadors: AmbassadorTallyRow[];
}) {
  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card">
      <div className="border-b border-crm-line px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          Source &amp; ambassador tally
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-5 text-[12.5px] text-crm-muted sm:px-6">
          No families yet — the tally starts with the first lead.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-crm-line font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
              <th className="px-5 py-2 font-normal sm:px-6">Source</th>
              <th className="px-3 py-2 text-right font-normal">Leads</th>
              <th className="px-5 py-2 text-right font-normal sm:px-6">Deposits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source} className="border-b border-crm-line last:border-b-0">
                <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-crm-ink sm:px-6">
                  {r.label}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-crm-ink">
                  {r.leads}
                </td>
                <td className="px-5 py-2 text-right font-mono text-[11px] text-crm-ink sm:px-6">
                  {r.deposits}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-crm-line px-5 py-3 sm:px-6">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-faint">
          Ambassadors · by referral code
        </p>
        {ambassadors.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-crm-muted">
            No AMB-* codes captured yet — codes issue in W2.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {ambassadors.map((a) => (
              <li
                key={a.code}
                className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.06em]"
              >
                <span className="text-crm-ink">{a.code}</span>
                <span className="text-crm-muted">
                  {a.leads} lead{a.leads === 1 ? "" : "s"} · {a.deposits} deposit
                  {a.deposits === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
