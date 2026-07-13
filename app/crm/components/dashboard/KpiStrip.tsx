/**
 * KPI strip (brief §8 unit 1; alphahub `kpi-strip` restyled): four bone
 * stat cards — mono kickers, Georgia numerals. Interested (consented,
 * /200) · Calls (booked cum / held cum) · Deposits (/48 + Δ this week) ·
 * Seats remaining (live `seats_claimed()` pipeline, red dot).
 */

function StatCard({
  kicker,
  children,
  detail,
}: {
  kicker: string;
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div
      role="listitem"
      className="rounded-[12px] border border-crm-line bg-crm-card px-5 py-4"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
        {kicker}
      </p>
      <p className="mt-2 font-serif text-[34px] font-normal leading-none tracking-[-0.01em] text-crm-ink">
        {children}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-crm-faint">
        {detail}
      </p>
    </div>
  );
}

const Denominator = ({ value }: { value: number }) => (
  <span className="text-[20px] text-crm-faint">/{value}</span>
);

export default function KpiStrip({
  interested,
  interestedTarget,
  callsBooked,
  callsBookedTarget,
  callsHeld,
  callsHeldTarget,
  deposits,
  depositsTarget,
  depositsDelta,
  seatsRemaining,
}: {
  interested: number;
  interestedTarget: number;
  callsBooked: number;
  callsBookedTarget: number;
  callsHeld: number;
  callsHeldTarget: number;
  deposits: number;
  depositsTarget: number;
  depositsDelta: number;
  seatsRemaining: number;
}) {
  return (
    <div role="list" aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard kicker="Interested families" detail="CASL-CONSENTED ONLY">
        {interested}
        <Denominator value={interestedTarget} />
      </StatCard>

      <StatCard
        kicker="Calls"
        detail={`BOOKED /${callsBookedTarget} · HELD /${callsHeldTarget}`}
      >
        {callsBooked}
        <span className="text-[20px] text-crm-faint"> booked · </span>
        {callsHeld}
        <span className="text-[20px] text-crm-faint"> held</span>
      </StatCard>

      <StatCard
        kicker="Deposits paid"
        detail={
          depositsDelta === 0
            ? "NO CHANGE THIS WEEK"
            : `${depositsDelta > 0 ? "▲ +" : "▼ "}${depositsDelta} THIS WEEK`
        }
      >
        {deposits}
        <Denominator value={depositsTarget} />
      </StatCard>

      <StatCard
        kicker="Seats remaining"
        detail={
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-crm-red"
            />
            LIVE · SEATS_CLAIMED()
          </span>
        }
      >
        {seatsRemaining}
      </StatCard>
    </div>
  );
}
