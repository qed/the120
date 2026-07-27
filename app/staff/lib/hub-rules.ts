/**
 * Every decision the staff hub takes (Unit 11; R1–R4).
 *
 * PLAIN module — no next/supabase/react imports — because this repo runs
 * `environment: "node"` with no jsdom: a decision written in `page.tsx` is a
 * decision CI cannot see, and that has been the headline finding of four units.
 * The page reads, calls these, renders.
 *
 * ── R4's ASYMMETRY, stated here because it is a property of the INPUTS
 *
 * The two cards degrade differently and cannot be made symmetrical:
 *   - The FW read (`listFwActiveWeekends`) returns a TYPED failure, so the FW card
 *     can honestly say "couldn't load the number just now" — a number-less card
 *     whose door still works. It must never render a fabricated 0, which matters
 *     doubly now that the TRUE count is 0 (all four rehearsal cohorts archived):
 *     a zero must be a fact, not a fallback.
 *   - `getSeatsRemaining()` CANNOT report failure — it falls back to a
 *     hand-maintained constant by design (the marketing site's contract, which
 *     this page inherits rather than forks). So the CRM card's number may be a
 *     stale constant, and the code does not claim it is live. That claim gap is
 *     recorded here, where the number is shaped, not discovered in a review.
 */

export type FwWeekendLike = {
  slug: string;
  startsAt: string | null;
  endsAt: string | null;
};

/**
 * Which weekend is "next" — the hub's one non-trivial derivation, pure and total.
 *
 *   - Sorted by `startsAt` ascending; null starts are EXCLUDED from "next" (a
 *     window-less weekend cannot be "upcoming" — it has no date to be upcoming
 *     ON) but still counted by the card's count, which is a different question.
 *   - A weekend IN PROGRESS (started, not ended) IS "next": the answer to "what
 *     is the next weekend that needs staff attention" is the one running right
 *     now, not the one after it. Defined, tested, and the reason stated — the
 *     plan demands each edge get a decided outcome rather than an accident.
 *   - All past (or none dated) → null, and the card copy handles it.
 */
export function nextFwWeekend(
  weekends: readonly FwWeekendLike[],
  nowMs: number
): FwWeekendLike | null {
  const dated = weekends
    .filter((w): w is FwWeekendLike & { startsAt: string } => w.startsAt !== null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const w of dated) {
    const ended = w.endsAt !== null && Date.parse(w.endsAt) <= nowMs;
    if (!ended) return w; // earliest not-yet-ended: upcoming, or in progress now
  }
  return null;
}

export type FwCardModel =
  | {
      kind: "counted";
      count: number;
      /** Null when count is 0, or when nothing dated is upcoming. */
      next: { slug: string; startsAt: string } | null;
    }
  /** The typed-failure degrade: no number, an honest sentence, a working door. */
  | { kind: "unavailable" };

/** Shape the FW card from the read's typed result. The `ok:false` branch is the
 *  R4 degrade — never a zero. */
export function fwCardModel(
  read: { ok: true; weekends: readonly FwWeekendLike[] } | { ok: false },
  nowMs: number
): FwCardModel {
  if (!read.ok) return { kind: "unavailable" };
  const next = nextFwWeekend(read.weekends, nowMs);
  return {
    kind: "counted",
    count: read.weekends.length,
    next: next && next.startsAt !== null ? { slug: next.slug, startsAt: next.startsAt } : null,
  };
}

/** The FW card's number line. Pure copy, one sentence per state. */
export function fwCardLine(model: FwCardModel): string {
  if (model.kind === "unavailable") {
    return "Couldn't load the weekend count just now — the door still works.";
  }
  if (model.count === 0) {
    return "No upcoming weekends. Create one from the ops page.";
  }
  const s = model.count === 1 ? "" : "s";
  const next = model.next ? ` Next: ${model.next.slug} (${model.next.startsAt.slice(0, 10)}).` : "";
  return `${model.count} upcoming weekend${s}.${next}`;
}

/** The CRM card's number line — and the honesty caveat lives IN the copy shape:
 *  the number is presented without a liveness claim, because the read cannot
 *  distinguish live from fallen-back (R4's other half). */
export function crmCardLine(seatsRemaining: number): string {
  return `${seatsRemaining} of 120 seats remaining.`;
}
