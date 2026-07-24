import { fwEventLocalParts, fwEventTimeZoneShort } from "@/app/path/lib/fw-ops-rules";

/**
 * A cohort's event window, rendered on the EVENT'S OWN CLOCK (FW Unit 5,
 * Decision 4).
 *
 * A server component with no state, so the reading never depends on the viewer's
 * machine. That is the whole point: staff in one city routinely set up a weekend
 * in another, and `ends_at` is the value the plan flags as able to silently
 * expire a projected board mid-event. Showing "ends 21:00" to someone who typed
 * "5:00 PM" — because their laptop is on UTC or Pacific — is how a wrong window
 * survives a review.
 *
 * A cohort with no stored zone (created before the column existed, or by SQL)
 * renders in UTC and SAYS "UTC". The honest fallback, not a silent one.
 */
export default function FwWindowLabel({
  startsAt,
  endsAt,
  timeZone,
}: {
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string | null;
}) {
  const start = fwEventLocalParts(startsAt, timeZone);
  const end = fwEventLocalParts(endsAt, timeZone);

  if (!start || !end) {
    // Not decoration: a cohort with no window cannot have a board token at all
    // (`no_event_window`), so this line is the explanation for a mint that is
    // about to be refused.
    return <span className="text-hq-ink-muted">No dates set — a board link needs them</span>;
  }

  return (
    <>
      {start.date} {start.time} → {end.date} {end.time}{" "}
      <span className="text-hq-ink-muted">{fwEventTimeZoneShort(timeZone)}</span>
    </>
  );
}
