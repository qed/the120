/**
 * Deposit thermometer (brief §8 unit 2): horizontal bar to the 48 target
 * with the 55 stretch marker, #D92632 fill on a bone track, mono caption
 * "48 BY SEP 1 · REFUNDABLE UNTIL SEP 30". Scale runs to the stretch so
 * both marks fit; the 48 line is the goal.
 */

export default function DepositThermometer({
  deposits,
  target = 48,
  stretch = 55,
}: {
  deposits: number;
  target?: number;
  stretch?: number;
}) {
  const scale = Math.max(stretch, target, deposits, 1);
  const fillPct = Math.min(100, (deposits / scale) * 100);
  const targetPct = (target / scale) * 100;

  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card px-5 py-4 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          Deposit thermometer
        </p>
        <p className="font-serif text-[28px] font-normal leading-none tracking-[-0.01em] text-crm-ink">
          {deposits}
          <span className="text-[17px] text-crm-faint">/{target}</span>
        </p>
      </div>

      <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-[#E0DDD7]">
        <div
          role="progressbar"
          aria-valuenow={deposits}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label={`${deposits} of ${target} deposits`}
          className="h-full rounded-full bg-crm-red"
          style={{ width: `${fillPct}%` }}
        />
        {/* 48 target line inside the track */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-[2px] bg-crm-ink"
          style={{ left: `${targetPct}%` }}
        />
      </div>

      <div className="relative mt-1.5 h-4 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
        <span className="absolute left-0">0</span>
        <span
          className="absolute -translate-x-1/2 text-crm-ink"
          style={{ left: `${targetPct}%` }}
        >
          {target} TARGET
        </span>
        <span className="absolute right-0">{stretch} STRETCH</span>
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-crm-muted">
        48 BY SEP 1 · REFUNDABLE UNTIL SEP 30
      </p>
    </section>
  );
}
