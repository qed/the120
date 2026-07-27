import { describe, expect, it } from "vitest";
import {
  crmCardLine,
  fwCardLine,
  fwCardModel,
  nextFwWeekend,
} from "../lib/hub-rules";

/**
 * The hub's decisions (Unit 11; R1–R4). Every plan scenario, plus the
 * launch-truth case R21 just made real: the true count IS 0, so the zero must be
 * distinguishable from the degraded number-less card in copy, kind, and cause.
 */

const NOW = Date.parse("2026-08-01T12:00:00Z");
const w = (slug: string, startsAt: string | null, endsAt: string | null) => ({
  slug,
  startsAt,
  endsAt,
});

describe("nextFwWeekend — pure, total, each edge decided", () => {
  it("two upcoming → the earlier wins", () => {
    const next = nextFwWeekend(
      [
        w("later", "2026-09-05T13:00:00Z", "2026-09-07T21:00:00Z"),
        w("sooner", "2026-08-21T13:00:00Z", "2026-08-23T21:00:00Z"),
      ],
      NOW
    );
    expect(next?.slug).toBe("sooner");
  });

  it("a weekend IN PROGRESS is 'next' — the one running now needs staff attention first", () => {
    // The plan demands this edge get a DECIDED outcome; the decision and its
    // reason live in the rule's docblock, and this pins which way it went.
    const next = nextFwWeekend(
      [
        w("running", "2026-07-31T13:00:00Z", "2026-08-02T21:00:00Z"), // started, not ended
        w("upcoming", "2026-08-21T13:00:00Z", "2026-08-23T21:00:00Z"),
      ],
      NOW
    );
    expect(next?.slug).toBe("running");
  });

  it("all past → null, no 'next'", () => {
    expect(
      nextFwWeekend([w("done", "2026-06-01T13:00:00Z", "2026-06-03T21:00:00Z")], NOW)
    ).toBeNull();
  });

  it("a null startsAt neither crashes nor wins", () => {
    const next = nextFwWeekend(
      [w("dateless", null, null), w("dated", "2026-08-21T13:00:00Z", "2026-08-23T21:00:00Z")],
      NOW
    );
    expect(next?.slug).toBe("dated");
    expect(nextFwWeekend([w("dateless", null, null)], NOW)).toBeNull();
  });

  it("started, endsAt null → still 'next' (not-ended is the predicate, not in-window)", () => {
    const next = nextFwWeekend([w("open-ended", "2026-07-31T13:00:00Z", null)], NOW);
    expect(next?.slug).toBe("open-ended");
  });
});

describe("fwCardModel + fwCardLine — R4's honest degrade, and the honest zero", () => {
  it("typed failure → 'unavailable', NEVER a zero", () => {
    // The launch state makes this load-bearing twice over: the TRUE count is 0,
    // so a fabricated 0 on a blip would be indistinguishable from the truth.
    const model = fwCardModel({ ok: false }, NOW);
    expect(model).toEqual({ kind: "unavailable" });
    expect(fwCardLine(model)).toMatch(/couldn't load/i);
    expect(fwCardLine(model)).not.toMatch(/\b0\b/);
    // …and the door still works is SAID, because a number-less card that looks
    // broken trains staff to stop clicking it.
    expect(fwCardLine(model)).toMatch(/door still works/i);
  });

  it("a REAL zero is a count with a create path — the launch truth, stated as fact", () => {
    const model = fwCardModel({ ok: true, weekends: [] }, NOW);
    expect(model).toEqual({ kind: "counted", count: 0, next: null });
    expect(fwCardLine(model)).toMatch(/no upcoming weekends/i);
    expect(fwCardLine(model)).toMatch(/create one/i);
  });

  it("counted with a next names it, dated", () => {
    const model = fwCardModel(
      {
        ok: true,
        weekends: [w("boston-2026-09", "2026-09-05T13:00:00Z", "2026-09-07T21:00:00Z")],
      },
      NOW
    );
    expect(fwCardLine(model)).toContain("1 upcoming weekend.");
    expect(fwCardLine(model)).toContain("boston-2026-09");
    expect(fwCardLine(model)).toContain("2026-09-05");
  });

  it("the COUNT includes dateless weekends even though 'next' excludes them — different questions", () => {
    const model = fwCardModel(
      { ok: true, weekends: [w("dateless", null, null)] },
      NOW
    );
    expect(model).toEqual({ kind: "counted", count: 1, next: null });
  });

  it("staff with two cohorts, one archived → count 1 (Unit 9's carried scenario)", () => {
    // listFwActiveWeekends excludes archived at the read; the card counts what it
    // is given. The composed fact — archived cohorts do not inflate the hub —
    // rests on that read's own tests plus this contract.
    const model = fwCardModel(
      {
        ok: true,
        weekends: [w("active-one", "2026-09-05T13:00:00Z", "2026-09-07T21:00:00Z")],
      },
      NOW
    );
    expect(model.kind === "counted" && model.count).toBe(1);
  });
});

describe("crmCardLine — a number without a liveness claim (R4's other half)", () => {
  it("states the count against the 120 total, and claims nothing about freshness", () => {
    const line = crmCardLine(87);
    expect(line).toBe("87 of 120 seats remaining.");
    // getSeatsRemaining cannot report failure — it falls back to a constant by
    // design — so the copy must never say "live", "current", or "right now".
    expect(line).not.toMatch(/live|current|right now|as of/i);
  });
});
