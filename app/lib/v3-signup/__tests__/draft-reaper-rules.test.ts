import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAFT_RETENTION_MS,
  GENERATION_IN_FLIGHT_MS,
  ORPHAN_ATTEMPT_MIN_AGE_MS,
  RESIDUAL_PHOTO_MIN_AGE_MS,
  draftReapVerdict,
  effectiveReapBoundMs,
  orphanAttemptVerdict,
  parseTimestampMs,
  type DraftReapCandidate,
  type OrphanAttemptCandidate,
} from "../draft-reaper-rules";

/**
 * The draft reaper's DECISIONS (whole-branch review, finding 2). Pure, so the
 * boundary that matters — "a live family's in-progress draft is never reaped" —
 * is asserted directly rather than inferred from a sequence.
 */

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const daysAgo = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

const draft = (over: Partial<DraftReapCandidate> = {}): DraftReapCandidate => ({
  id: "draft-1",
  status: "active",
  coverStatus: "final",
  childId: null,
  updatedAtMs: daysAgo(40),
  photoBlobKey: null,
  coverBlobKey: null,
  ...over,
});

describe("the retention boundary", () => {
  it("is 30 days, in one named constant", () => {
    // The plan's commitment, pinned. If this number ever changes it should be a
    // deliberate edit to a documented promise, not a drifted magic number.
    expect(DRAFT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("reaps an abandoned draft past the bound", () => {
    expect(draftReapVerdict(draft(), NOW)).toEqual({ kind: "reap", targets: [] });
  });

  it("reaps at exactly the bound, and not one millisecond before", () => {
    const at = draft({ updatedAtMs: NOW - DRAFT_RETENTION_MS });
    expect(draftReapVerdict(at, NOW).kind).toBe("reap");
    const justInside = draft({ updatedAtMs: NOW - DRAFT_RETENTION_MS + 1 });
    expect(draftReapVerdict(justInside, NOW)).toEqual({
      kind: "skip",
      reason: "within_retention",
    });
  });
});

describe("a LIVE draft is never reaped — the boundary that matters", () => {
  it("leaves a draft the family touched today, however old it was created", () => {
    // The migration's own warning: `updated_at` is the reaping clock, not
    // `created_at`. A family that started 29 days ago and came back today must
    // not be reaped out from under the tab they are looking at.
    expect(draftReapVerdict(draft({ updatedAtMs: daysAgo(0) }), NOW)).toEqual({
      kind: "skip",
      reason: "within_retention",
    });
    expect(draftReapVerdict(draft({ updatedAtMs: daysAgo(29) }), NOW)).toEqual({
      kind: "skip",
      reason: "within_retention",
    });
  });

  it("leaves a draft carried to a provisioned child, however old", () => {
    // The draft's OWN child stamp, never a join to fp_signup_attempts — whose
    // `child_created` advance is deliberately non-fatal, so a live child can sit
    // behind an attempt still in state 'verified'.
    expect(
      draftReapVerdict(draft({ updatedAtMs: daysAgo(400), childId: "child-1" }), NOW)
    ).toEqual({ kind: "skip", reason: "carried_to_child" });
  });

  it("never reaps a draft younger than the generation timeout, whatever the retention bound is", () => {
    // The migration asked for a "skip fresh `generating` rows" guard. It is a
    // MAX rather than a second branch, because at a 30-day retention bound a
    // separate branch would be unreachable code guarding a destructive action.
    // Asserted at the bound function so it is a real, checkable property.
    expect(effectiveReapBoundMs("generating")).toBeGreaterThanOrEqual(GENERATION_IN_FLIGHT_MS);
    expect(effectiveReapBoundMs("final")).toBe(DRAFT_RETENTION_MS);
    // Today it is fully subsumed — stated so a future shortening of the
    // retention bound is a deliberate, visible change rather than a silent one.
    expect(GENERATION_IN_FLIGHT_MS).toBeLessThanOrEqual(DRAFT_RETENTION_MS);
    // And a long-stale `generating` row IS collected: an abandoned generation
    // must not become a permanent exemption.
    expect(
      draftReapVerdict(draft({ coverStatus: "generating", updatedAtMs: daysAgo(40) }), NOW).kind
    ).toBe("reap");
  });

  it("FAILS CLOSED on a clock it cannot read — never 'infinitely old'", () => {
    expect(draftReapVerdict(draft({ updatedAtMs: null }), NOW)).toEqual({
      kind: "skip",
      reason: "unreadable_clock",
    });
    expect(draftReapVerdict(draft({ updatedAtMs: Number.NaN }), NOW)).toEqual({
      kind: "skip",
      reason: "unreadable_clock",
    });
  });
});

describe("the objects a reap names", () => {
  it("names both blob columns, tagged with the column that points at each", () => {
    const verdict = draftReapVerdict(
      draft({ photoBlobKey: "drafts/draft-1/photo", coverBlobKey: "drafts/draft-1/cover" }),
      NOW
    );
    expect(verdict).toEqual({
      kind: "reap",
      targets: [
        { column: "photo_blob_key", key: "drafts/draft-1/photo" },
        { column: "cover_blob_key", key: "drafts/draft-1/cover" },
      ],
    });
  });

  it("drops blanks and repeats", () => {
    const verdict = draftReapVerdict(
      draft({ photoBlobKey: "  ", coverBlobKey: "drafts/draft-1/cover" }),
      NOW
    );
    expect(verdict).toEqual({
      kind: "reap",
      targets: [{ column: "cover_blob_key", key: "drafts/draft-1/cover" }],
    });
  });
});

describe("residue on terminal rows", () => {
  it("sweeps a CONSUMED draft's surviving source photo — and never its cover", () => {
    // The cover is deliberately out of scope: "the carry copies the cover to a
    // child-namespaced key" is a property of the carry, and if it ever failed
    // to copy, deleting here would erase a live child's cover.
    const verdict = draftReapVerdict(
      draft({
        status: "consumed",
        childId: "child-1",
        updatedAtMs: daysAgo(2),
        photoBlobKey: "drafts/draft-1/photo",
        coverBlobKey: "drafts/draft-1/cover",
      }),
      NOW
    );
    expect(verdict).toEqual({
      kind: "sweep_residual",
      targets: [{ column: "photo_blob_key", key: "drafts/draft-1/photo" }],
    });
  });

  it("waits out the residual bound on a consumed draft", () => {
    expect(
      draftReapVerdict(
        draft({
          status: "consumed",
          updatedAtMs: NOW - RESIDUAL_PHOTO_MIN_AGE_MS + 1,
          photoBlobKey: "drafts/draft-1/photo",
        }),
        NOW
      )
    ).toEqual({ kind: "skip", reason: "nothing_to_sweep" });
  });

  it("RETRIES a claimed reap whose store deletes did not finish — both keys, no extra wait", () => {
    // This is what makes the claim-then-delete order idempotent: a `reaped` row
    // that still names keys is re-read and re-swept until the store confirms.
    const verdict = draftReapVerdict(
      draft({
        status: "reaped",
        updatedAtMs: NOW - 1,
        photoBlobKey: "drafts/draft-1/photo",
        coverBlobKey: "drafts/draft-1/cover",
      }),
      NOW
    );
    expect(verdict).toEqual({
      kind: "sweep_residual",
      targets: [
        { column: "photo_blob_key", key: "drafts/draft-1/photo" },
        { column: "cover_blob_key", key: "drafts/draft-1/cover" },
      ],
    });
  });

  it("leaves a terminal draft that names nothing", () => {
    expect(draftReapVerdict(draft({ status: "consumed", childId: "c" }), NOW)).toEqual({
      kind: "skip",
      reason: "not_active",
    });
  });
});

/* -------------------------------------------------------- orphan attempts */

const orphan = (over: Partial<OrphanAttemptCandidate> = {}): OrphanAttemptCandidate => ({
  id: "attempt-1",
  state: "verified",
  hasVerificationSecret: false,
  childId: null,
  hasDraft: false,
  hasChildBoundConsent: false,
  updatedAtMs: daysAgo(30),
  ...over,
});

describe("the orphan-attempt backstop", () => {
  it("sweeps an add-kid attempt that reached neither a draft nor a child", () => {
    expect(orphanAttemptVerdict(orphan(), NOW)).toEqual({ kind: "sweep" });
  });

  it("refuses on EVERY proof that something real depends on the row", () => {
    // Five independent guards. Each is asserted separately because the consent
    // row this sweep deletes is legal evidence — deleting live evidence is the
    // failure with no undo, so no guard may rest on another.
    const cases: [Partial<OrphanAttemptCandidate>, string][] = [
      [{ state: "started" }, "not_loop_entry_state"],
      [{ state: "child_created" }, "not_loop_entry_state"],
      [{ state: "abandoned" }, "not_loop_entry_state"],
      // A parent's step-1 attempt keeps its code hash forever (neither redeem
      // path clears it), which is exactly what makes "carries no secret" a
      // reliable discriminator for the add-kid loop's attempts.
      [{ hasVerificationSecret: true }, "carries_a_verification_secret"],
      [{ childId: "child-1" }, "has_child"],
      [{ hasDraft: true }, "has_draft"],
      // consentGate binds child_id BEFORE the child is minted, so a bound
      // consent proves a child exists even when the attempt's own bookkeeping
      // never caught up (child-core's state advance is non-fatal by design).
      [{ hasChildBoundConsent: true }, "consent_bound_to_child"],
      [{ updatedAtMs: NOW - ORPHAN_ATTEMPT_MIN_AGE_MS + 1 }, "too_recent"],
      [{ updatedAtMs: null }, "unreadable_clock"],
    ];
    for (const [over, reason] of cases) {
      expect(orphanAttemptVerdict(orphan(over), NOW), JSON.stringify(over)).toEqual({
        kind: "skip",
        reason,
      });
    }
  });
});

describe("the reaper is actually SCHEDULED", () => {
  it("vercel.json runs /api/cron/v3-draft-reaper daily", () => {
    // The defect this whole unit answers was a retention promise with no code.
    // A reaper route that no cron invokes is the same defect one layer along,
    // so the schedule is pinned here rather than remembered.
    const vercel = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/v3-draft-reaper");
    expect(cron).toBeDefined();
    // Daily, not weekly: with a 30-day bound an outage should cost a day of
    // overshoot, not a week. Minute/hour are free to move; the daily cadence
    // is the property.
    expect(cron!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});

describe("parseTimestampMs", () => {
  it("returns null for absent, blank and unparsable values", () => {
    for (const bad of [null, undefined, "", "   ", "not a date", 12345]) {
      expect(parseTimestampMs(bad), String(bad)).toBeNull();
    }
  });

  it("parses an ISO timestamp", () => {
    expect(parseTimestampMs("2026-08-06T12:00:00.000Z")).toBe(NOW);
  });
});
