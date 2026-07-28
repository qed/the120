import { describe, expect, it } from "vitest";

import type { FwRejectReason } from "../fw-sync-rules";
import {
  FW_EVENT_TIME_ZONES,
  FW_OPS_AUDIT_ACTIONS,
  FW_TOMBSTONE_FIRST_NAME,
  FW_TOMBSTONE_LAST_NAME,
  fwAnonymizeConfirmMatches,
  fwCohortWindowFromLocal,
  fwEventLocalParts,
  fwReplayRejectReasonCopy,
  isFwTombstoneName,
  narrowFwEventTimeZone,
  normalizeFwCohortSlug,
  archiveFwCohortFailureCopy,
  deleteFwCohortFailureCopy,
  remintFwBoardTokenFailureCopy,
  unarchiveFwCohortFailureCopy,
  updateFwCohortWindowFailureCopy,
  fwArchivedBanner,
  fwArchiveConfirmMatches,
  fwSlugTakenCopy,
  fwOpsCohortAffordances,
} from "../fw-ops-rules";

/**
 * The cohort-window conversion (FW Unit 5; Decision 4) — the test the plan asks
 * for by name: "the ops form is explicitly timezone-aware — five cities, three
 * zones — with a test pinning the conversion".
 *
 * This is the one place in the unit where a wrong value is SILENT. `ends_at`
 * derives every board token's expiry, so an hour of drift here does not throw,
 * does not log, and does not surface until a projector goes dark in front of a
 * room. Every case below is a specific instant, written out, so a change to the
 * conversion has to change a number a human wrote on purpose.
 */

describe("FW_EVENT_TIME_ZONES", () => {
  it("covers the three zones the five event cities sit in", () => {
    expect(FW_EVENT_TIME_ZONES.map((z) => z.id)).toEqual([
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
    ]);
  });

  it("names cities in every label, because staff pick a city and not a zone", () => {
    for (const zone of FW_EVENT_TIME_ZONES) {
      expect(zone.label.length).toBeGreaterThan(zone.short.length);
      expect(zone.label).toContain(zone.short);
    }
    // Every event city the plan names has to appear SOMEWHERE in the list, or
    // staff creating that city's weekend have no on-screen confirmation they
    // picked the right zone. Asserted per city, not per zone.
    const labels = FW_EVENT_TIME_ZONES.map((z) => z.label).join(" | ");
    for (const city of ["Boston", "Hamptons", "New York", "Chicago", "San Francisco", "Los Angeles"]) {
      expect(labels, city).toContain(city);
    }
  });
});

describe("narrowFwEventTimeZone", () => {
  it("accepts an allowlisted zone", () => {
    expect(narrowFwEventTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("refuses anything outside the allowlist, including real IANA zones", () => {
    // Real and valid, but not an event zone. Accepting arbitrary zones would
    // make the stored provenance unbounded and the form a free-text field.
    expect(narrowFwEventTimeZone("Europe/London")).toBeNull();
    expect(narrowFwEventTimeZone("UTC")).toBeNull();
    expect(narrowFwEventTimeZone("america/new_york")).toBeNull();
    expect(narrowFwEventTimeZone("")).toBeNull();
    expect(narrowFwEventTimeZone(null)).toBeNull();
    expect(narrowFwEventTimeZone(42)).toBeNull();
  });
});

describe("fwCohortWindowFromLocal — the pinned conversion", () => {
  const boston = {
    startDate: "2026-08-21",
    startTime: "09:00",
    endDate: "2026-08-23",
    endTime: "17:00",
    timeZone: "America/New_York",
  };

  it("converts Boston's real weekend (Eastern, daylight time) to UTC", () => {
    // Aug → EDT (UTC-4). 9:00 local = 13:00Z; 17:00 local = 21:00Z.
    expect(fwCohortWindowFromLocal(boston)).toEqual({
      ok: true,
      startsAt: "2026-08-21T13:00:00.000Z",
      endsAt: "2026-08-23T21:00:00.000Z",
    });
  });

  it("converts Central", () => {
    // CDT (UTC-5).
    expect(fwCohortWindowFromLocal({ ...boston, timeZone: "America/Chicago" })).toEqual({
      ok: true,
      startsAt: "2026-08-21T14:00:00.000Z",
      endsAt: "2026-08-23T22:00:00.000Z",
    });
  });

  it("converts Pacific, where the end rolls into the NEXT UTC day", () => {
    // PDT (UTC-7). 17:00 Sun local = 00:00Z Monday — the case where a naive
    // "just store the date" would report the weekend ending a day late.
    expect(fwCohortWindowFromLocal({ ...boston, timeZone: "America/Los_Angeles" })).toEqual({
      ok: true,
      startsAt: "2026-08-21T16:00:00.000Z",
      endsAt: "2026-08-24T00:00:00.000Z",
    });
  });

  it("uses STANDARD time out of daylight season, so the offset is not hardcoded", () => {
    // January → EST (UTC-5), one hour different from the August cases above.
    // A fixed -4 would pass every test before this one.
    expect(
      fwCohortWindowFromLocal({
        startDate: "2027-01-15",
        startTime: "09:00",
        endDate: "2027-01-17",
        endTime: "17:00",
        timeZone: "America/New_York",
      })
    ).toEqual({
      ok: true,
      startsAt: "2027-01-15T14:00:00.000Z",
      endsAt: "2027-01-17T22:00:00.000Z",
    });
  });

  it("handles a window that straddles a DST transition", () => {
    // Nov 1 2026 is fall-back in the US. Start Oct 31 (EDT, UTC-4), end Nov 1
    // 17:00 (EST, UTC-5) — the two ends legitimately use different offsets.
    expect(
      fwCohortWindowFromLocal({
        startDate: "2026-10-31",
        startTime: "09:00",
        endDate: "2026-11-01",
        endTime: "17:00",
        timeZone: "America/New_York",
      })
    ).toEqual({
      ok: true,
      startsAt: "2026-10-31T13:00:00.000Z",
      endsAt: "2026-11-01T22:00:00.000Z",
    });
  });

  it("refuses a local time that does not exist (spring-forward gap)", () => {
    // 2026-03-08 02:30 America/New_York never happens — the clock jumps 02:00
    // to 03:00. Silently resolving it to 01:30 or 03:30 would store an instant
    // nobody typed.
    expect(
      fwCohortWindowFromLocal({
        startDate: "2026-03-08",
        startTime: "02:30",
        endDate: "2026-03-08",
        endTime: "17:00",
        timeZone: "America/New_York",
      })
    ).toEqual({ ok: false, reason: "nonexistent_start" });
  });

  it("resolves an ambiguous local time (fall-back) to its FIRST occurrence", () => {
    // 2026-11-01 01:30 happens twice. Documented, deterministic choice: the
    // earlier (daylight) one. Refusing would be pedantry on a value staff can
    // simply retype; drifting between the two would not be deterministic.
    expect(
      fwCohortWindowFromLocal({
        startDate: "2026-11-01",
        startTime: "01:30",
        endDate: "2026-11-01",
        endTime: "17:00",
        timeZone: "America/New_York",
      })
    ).toEqual({
      ok: true,
      startsAt: "2026-11-01T05:30:00.000Z",
      endsAt: "2026-11-01T22:00:00.000Z",
    });
  });

  it("refuses a zone outside the allowlist before doing any date work", () => {
    expect(fwCohortWindowFromLocal({ ...boston, timeZone: "Mars/Olympus" })).toEqual({
      ok: false,
      reason: "invalid_time_zone",
    });
  });

  it("refuses malformed dates and times rather than rolling them over", () => {
    // Date.UTC(2026, 12, …) silently becomes January 2027 and Date.UTC(…, 25)
    // becomes the next day — which is why the components are range-checked
    // rather than handed to Date.UTC and trusted.
    expect(fwCohortWindowFromLocal({ ...boston, startDate: "2026-13-01" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startDate: "2026-08-32" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startTime: "25:00" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startTime: "09:60" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startDate: "8/21/2026" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startTime: "9am" }).ok).toBe(false);
    expect(fwCohortWindowFromLocal({ ...boston, startDate: "" }).ok).toBe(false);
  });

  it("names WHICH end was malformed", () => {
    expect(fwCohortWindowFromLocal({ ...boston, startDate: "nope" })).toEqual({
      ok: false,
      reason: "invalid_start",
    });
    expect(fwCohortWindowFromLocal({ ...boston, endTime: "nope" })).toEqual({
      ok: false,
      reason: "invalid_end",
    });
  });

  it("rejects a Feb 30 that a rollover would have accepted", () => {
    expect(
      fwCohortWindowFromLocal({ ...boston, startDate: "2026-02-30", endDate: "2026-03-02" })
    ).toEqual({ ok: false, reason: "invalid_start" });
  });

  it("refuses a backwards or zero-length window, matching the DB CHECK", () => {
    // path_cohorts_window_ordered is `ends_at > starts_at`. Catching it here
    // gives staff a sentence instead of a constraint-violation error string.
    expect(
      fwCohortWindowFromLocal({ ...boston, endDate: "2026-08-20", endTime: "17:00" })
    ).toEqual({ ok: false, reason: "window_not_ordered" });
    expect(
      fwCohortWindowFromLocal({ ...boston, endDate: "2026-08-21", endTime: "09:00" })
    ).toEqual({ ok: false, reason: "window_not_ordered" });
  });

  it("orders the window check by INSTANT, not by wall clock", () => {
    // Both ends are valid; only the conversion tells you they are inverted.
    expect(
      fwCohortWindowFromLocal({
        startDate: "2026-08-21",
        startTime: "09:00",
        endDate: "2026-08-21",
        endTime: "09:30",
        timeZone: "America/New_York",
      }).ok
    ).toBe(true);
  });
});

describe("fwEventLocalParts — the inverse the ops surface renders with", () => {
  it("round-trips every zone", () => {
    for (const zone of FW_EVENT_TIME_ZONES) {
      const converted = fwCohortWindowFromLocal({
        startDate: "2026-08-21",
        startTime: "09:00",
        endDate: "2026-08-23",
        endTime: "17:00",
        timeZone: zone.id,
      });
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      expect(fwEventLocalParts(converted.startsAt, zone.id)).toEqual({
        date: "2026-08-21",
        time: "09:00",
      });
      expect(fwEventLocalParts(converted.endsAt, zone.id)).toEqual({
        date: "2026-08-23",
        time: "17:00",
      });
    }
  });

  it("round-trips across the UTC-day boundary Pacific creates", () => {
    // The stored instant is Monday in UTC; the room's clock says Sunday.
    expect(fwEventLocalParts("2026-08-24T00:00:00.000Z", "America/Los_Angeles")).toEqual({
      date: "2026-08-23",
      time: "17:00",
    });
  });

  it("round-trips in standard time too", () => {
    expect(fwEventLocalParts("2027-01-15T14:00:00.000Z", "America/New_York")).toEqual({
      date: "2027-01-15",
      time: "09:00",
    });
  });

  it("falls back to a UTC reading when the zone is missing or unknown", () => {
    // A cohort created before this column existed, or a hand-edited row. The
    // caller labels it "UTC" — the point is that it must not throw (Intl
    // throws RangeError on an unknown zone) and must not silently pretend the
    // value is local.
    expect(fwEventLocalParts("2026-08-23T21:00:00.000Z", null)).toEqual({
      date: "2026-08-23",
      time: "21:00",
    });
    expect(fwEventLocalParts("2026-08-23T21:00:00.000Z", "Mars/Olympus")).toEqual({
      date: "2026-08-23",
      time: "21:00",
    });
  });

  it("returns null for an unreadable instant instead of throwing", () => {
    expect(fwEventLocalParts("not a date", "America/New_York")).toBeNull();
    expect(fwEventLocalParts(null, "America/New_York")).toBeNull();
  });
});

describe("normalizeFwCohortSlug", () => {
  it("passes an already-clean slug", () => {
    expect(normalizeFwCohortSlug("boston-2026-08")).toBe("boston-2026-08");
  });

  it("lowercases, folds accents, and hyphenates what staff actually type", () => {
    expect(normalizeFwCohortSlug("Boston 2026 08")).toBe("boston-2026-08");
    expect(normalizeFwCohortSlug("  Montréal   Fall  ")).toBe("montreal-fall");
    expect(normalizeFwCohortSlug("Boston/Hamptons_2026")).toBe("boston-hamptons-2026");
    expect(normalizeFwCohortSlug("boston--2026")).toBe("boston-2026");
  });

  it("refuses what would collapse to nothing or to a meaningless key", () => {
    expect(normalizeFwCohortSlug("")).toBeNull();
    expect(normalizeFwCohortSlug("   ")).toBeNull();
    expect(normalizeFwCohortSlug("---")).toBeNull();
    expect(normalizeFwCohortSlug("!!!")).toBeNull();
    // The slug IS the name a guide sees in the header (Unit 4 renders it), so a
    // two-character key is a label nobody can act on.
    expect(normalizeFwCohortSlug("ab")).toBeNull();
  });

  it("refuses an over-long slug rather than truncating one", () => {
    // Truncation would silently create a DIFFERENT cohort key than the one
    // staff typed, and the column is unique — a second truncated entry would
    // collide with the first for no visible reason.
    expect(normalizeFwCohortSlug("b".repeat(61))).toBeNull();
    expect(normalizeFwCohortSlug("b".repeat(60))).toBe("b".repeat(60));
  });
});

describe("FW_OPS_AUDIT_ACTIONS", () => {
  it("is exactly the vocabulary the migrations' CHECK allows", () => {
    // Pinned against the migration text itself in fw-ops-migration-parity.test
    // — this assertion is the TS half, and the drift it guards is the one
    // docs/solutions/best-practices/crm-audit-action-allowlist-… is about. Unit
    // 5b adds the third value; the live CHECK is superseded by
    // 20260801150000_fw_anonymize_action.sql, which the parity test pins.
    expect([...FW_OPS_AUDIT_ACTIONS]).toEqual([
      "guide_grant_added",
      "guide_grant_revoked",
      "student_anonymized",
    ]);
  });

  it("has no duplicates — a repeated action would silently pass set-equality", () => {
    expect(new Set(FW_OPS_AUDIT_ACTIONS).size).toBe(FW_OPS_AUDIT_ACTIONS.length);
  });
});

describe("isFwTombstoneName / the anonymize sentinel", () => {
  it("recognises exactly the tombstone pair, case-sensitively", () => {
    expect(isFwTombstoneName(FW_TOMBSTONE_FIRST_NAME, FW_TOMBSTONE_LAST_NAME)).toBe(true);
    expect(isFwTombstoneName("Removed", "student")).toBe(true);
    // A real student named "Removed" is vanishingly unlikely, and even one would
    // only mis-read as anonymized on the roster chip — but the last-name half
    // makes the pair, not either token alone.
    expect(isFwTombstoneName("Removed", "Chen")).toBe(false);
    expect(isFwTombstoneName("Maya", "student")).toBe(false);
    expect(isFwTombstoneName("removed", "student")).toBe(false);
    expect(isFwTombstoneName(null, null)).toBe(false);
    expect(isFwTombstoneName(undefined, 42)).toBe(false);
  });
});

describe("fwAnonymizeConfirmMatches — the typed confirm, verified server-side", () => {
  it("matches the child's own name across case, spacing, and accents", () => {
    expect(fwAnonymizeConfirmMatches("Maya Chen", "Maya", "Chen")).toBe(true);
    expect(fwAnonymizeConfirmMatches("maya   chen", "Maya", "Chen")).toBe(true);
    expect(fwAnonymizeConfirmMatches("  MAYA CHEN  ", "Maya", "Chen")).toBe(true);
    // The fold both sides pass through equates these; anonymizing the wrong
    // child should be hard, but a diacritic typo is not "the wrong child".
    expect(fwAnonymizeConfirmMatches("José Órsted", "Jose", "Orsted")).toBe(true);
  });

  it("keeps a multi-word first name whole", () => {
    // Last whitespace run separates first from last, so "Mary Jane Watson"
    // confirms a student stored as first "Mary Jane", last "Watson".
    expect(fwAnonymizeConfirmMatches("Mary Jane Watson", "Mary Jane", "Watson")).toBe(true);
  });

  it("refuses a different child, a partial name, or an empty confirm", () => {
    expect(fwAnonymizeConfirmMatches("Maya Chen", "Maya", "Chan")).toBe(false);
    expect(fwAnonymizeConfirmMatches("Maya", "Maya", "Chen")).toBe(false); // no last name
    expect(fwAnonymizeConfirmMatches("", "Maya", "Chen")).toBe(false);
    expect(fwAnonymizeConfirmMatches("   ", "Maya", "Chen")).toBe(false);
  });

  it("refuses everything against an already-tombstoned / unkeyable stored name", () => {
    // The stored name folds to a key the confirm cannot reach, so the resume path
    // (which skips the confirm for a tombstoned row) is the ONLY way past it —
    // never a typed string.
    expect(
      fwAnonymizeConfirmMatches(
        `${FW_TOMBSTONE_FIRST_NAME} ${FW_TOMBSTONE_LAST_NAME}`,
        FW_TOMBSTONE_FIRST_NAME,
        FW_TOMBSTONE_LAST_NAME
      )
    ).toBe(true);
    // A homoglyph stored name cannot be keyed → no confirm matches it.
    expect(fwAnonymizeConfirmMatches("Mаya Chen", "Mаya", "Chen")).toBe(false);
  });

  it("treats a homoglyph CONFIRM as no match, never as a wildcard", () => {
    // Cyrillic а in the typed string throws inside the fold → false, not a pass.
    expect(fwAnonymizeConfirmMatches("Mаya Chen", "Maya", "Chen")).toBe(false);
  });
});

describe("fwReplayRejectReasonCopy", () => {
  it("renders prose for EVERY FwRejectReason the Unit-8 drain produces", () => {
    // The five values of FwRejectReason (fw-sync-rules.ts) — the drain now WRITES
    // these rows, so each must render a sentence, not the raw machine string. A drain
    // reason with no copy would show blank on the staff reject list. `missing_progress`
    // was the api-contract review's gap. (A previously-speculative sixth reason,
    // `cas_lost`, was removed in Unit 9: the CAS-refused replay it anticipated ships
    // under `cross_actor_undo`, so nothing produces `cas_lost` and its dead copy is gone.)
    const drainReasons: FwRejectReason[] = [
      "cross_actor_undo",
      "reauth_failed",
      "cohort_unresolved",
      "guard_refused",
      "missing_progress",
    ];
    for (const reason of drainReasons) {
      const copy = fwReplayRejectReasonCopy(reason);
      expect(copy.length).toBeGreaterThan(0);
      // Known reasons render prose, not the raw machine string.
      expect(copy).not.toBe(reason);
    }
  });

  it("names an unmapped reason rather than dropping it — the vocabulary is not frozen", () => {
    // A reason this table has no copy for still has to be legible: a future machine
    // string must surface as itself, never as a blank or a crash.
    expect(fwReplayRejectReasonCopy("some_future_reason")).toContain("some_future_reason");
  });
});

describe("archive/unarchive failure copy (Unit 7)", () => {
  it("collapses the id-probing reasons to the staff-only sentence", () => {
    expect(archiveFwCohortFailureCopy("cohort_not_found")).toBe("That action is staff-only.");
    expect(archiveFwCohortFailureCopy("cohort_not_fw")).toBe("That action is staff-only.");
    expect(unarchiveFwCohortFailureCopy("cohort_not_found")).toBe(
      unarchiveFwCohortFailureCopy("cohort_not_fw")
    );
  });

  it("revoke_failed says the weekend was NOT archived — the ordering's user-facing half", () => {
    const copy = archiveFwCohortFailureCopy("revoke_failed");
    expect(copy).toMatch(/NOT archived/);
    expect(copy).toMatch(/board/i);
  });

  it("already_archived and already_active are calm facts, not errors", () => {
    expect(archiveFwCohortFailureCopy("already_archived")).toMatch(/someone got there first/i);
    expect(unarchiveFwCohortFailureCopy("already_active")).toMatch(/already active/i);
    for (const c of [
      archiveFwCohortFailureCopy("already_archived"),
      unarchiveFwCohortFailureCopy("already_active"),
    ]) {
      expect(c).not.toMatch(/error|fail/i);
    }
  });

  it("confirm_mismatch says the typed name is wrong, without blame or jargon (Unit 2)", () => {
    // The server-verified confirm's refusal. Staff normally never meet it — the
    // button is disabled until the client-side match — so it exists for the
    // caller that skipped the browser, and still speaks the house voice.
    const copy = archiveFwCohortFailureCopy("confirm_mismatch");
    expect(copy).toBe("The name you typed doesn't match this weekend.");
    expect(copy).not.toMatch(/error|invalid|slug/i);
  });

  it("unavailable claims nothing was changed and names the retry", () => {
    for (const c of [
      archiveFwCohortFailureCopy("unavailable"),
      unarchiveFwCohortFailureCopy("unavailable"),
    ]) {
      expect(c).toMatch(/nothing was changed/i);
      expect(c).toMatch(/try again/i);
    }
  });
});

describe("delete failure copy (redesign Unit 3) — its OWN switch, exhaustively", () => {
  it("collapses the id-probing reasons to the staff-only sentence, like archive", () => {
    expect(deleteFwCohortFailureCopy("cohort_not_found")).toBe("That action is staff-only.");
    expect(deleteFwCohortFailureCopy("cohort_not_fw")).toBe("That action is staff-only.");
  });

  it("confirm_mismatch speaks the same fact as archive's, from its own function", () => {
    // The FACT is identical (one slug, one match rule) but the sentence is owned
    // here — sharing the archive switch would let one surface's copy edit
    // silently reword the other's.
    const copy = deleteFwCohortFailureCopy("confirm_mismatch");
    expect(copy).toBe("The name you typed doesn't match this weekend.");
    expect(copy).not.toMatch(/error|invalid|slug/i);
  });

  it("not_untouched says the weekend has history, points at archive, and claims no delete", () => {
    // Covers BOTH the classifier's refusal and the 23503 backstop — the same
    // fact learned at different moments, so one sentence: it stopped qualifying.
    const copy = deleteFwCohortFailureCopy("not_untouched");
    expect(copy).toMatch(/history/i);
    expect(copy).toMatch(/archive it instead/i);
    expect(copy).toMatch(/nothing was deleted/i);
    expect(copy).not.toMatch(/error|constraint|foreign key|23503/i);
  });

  it("unavailable claims nothing was changed and names the retry", () => {
    const copy = deleteFwCohortFailureCopy("unavailable");
    expect(copy).toMatch(/nothing was changed/i);
    expect(copy).toMatch(/try again/i);
  });
});

describe("window-edit failure copy (redesign Unit 4)", () => {
  it("collapses the id-probing reasons to the staff-only sentence, like its siblings", () => {
    expect(updateFwCohortWindowFailureCopy("cohort_not_found")).toBe("That action is staff-only.");
    expect(updateFwCohortWindowFailureCopy("cohort_not_fw")).toBe("That action is staff-only.");
  });

  it("cohort_archived points at restore and claims nothing changed", () => {
    const copy = updateFwCohortWindowFailureCopy("cohort_archived");
    expect(copy).toMatch(/archived/i);
    expect(copy).toMatch(/restore/i);
    expect(copy).toMatch(/nothing was changed/i);
  });

  it("unavailable claims nothing was changed and names the retry", () => {
    const copy = updateFwCohortWindowFailureCopy("unavailable");
    expect(copy).toMatch(/nothing was changed/i);
    expect(copy).toMatch(/try again/i);
  });
});

describe("re-mint failure copy (redesign Unit 4) — every refusal states the old link's fate", () => {
  it("collapses the id-probing reasons to the staff-only sentence", () => {
    expect(remintFwBoardTokenFailureCopy("cohort_not_found")).toBe("That action is staff-only.");
    expect(remintFwBoardTokenFailureCopy("cohort_not_fw")).toBe("That action is staff-only.");
  });

  it("window_passed says the corrected window is over and the current link survives", () => {
    // The verdict-first sequence's user-facing half: a refusal revokes nothing,
    // and the copy says so — otherwise a refused re-mint reads as a dead board.
    const copy = remintFwBoardTokenFailureCopy("window_passed");
    expect(copy).toMatch(/corrected window is already over/i);
    expect(copy).toMatch(/can't be re-minted/i);
    expect(copy).toMatch(/current link keeps working/i);
  });

  it("stale_view says nothing was revoked and names the reload", () => {
    const copy = remintFwBoardTokenFailureCopy("stale_view");
    expect(copy).toMatch(/out of date/i);
    expect(copy).toMatch(/nothing was revoked/i);
    expect(copy).toMatch(/reload/i);
  });

  it("no_active_token sends staff to the board panel for a fresh mint", () => {
    const copy = remintFwBoardTokenFailureCopy("no_active_token");
    expect(copy).toMatch(/no live board link/i);
    expect(copy).toMatch(/board panel/i);
  });

  it("cohort_archived, no_event_window, and unavailable each claim the current link untouched", () => {
    for (const reason of ["cohort_archived", "no_event_window", "unavailable"] as const) {
      expect(remintFwBoardTokenFailureCopy(reason)).toMatch(/not touched/i);
    }
    expect(remintFwBoardTokenFailureCopy("cohort_archived")).toMatch(/restore/i);
    expect(remintFwBoardTokenFailureCopy("unavailable")).toMatch(/try again/i);
  });
});

describe("fwArchivedBanner (Unit 9)", () => {
  it("the LAUNCH state — archived_at set, archived_by NULL — says unrecorded, never blank", () => {
    // The plan's named edge: all four backfilled cohorts ship in exactly this
    // state, and it is the ONLY attribution state present at launch.
    const b = fwArchivedBanner({
      archivedAt: "2026-08-24T00:00:00Z",
      archivedBy: { kind: "unrecorded" },
    });
    expect(b.title).toMatch(/archived/i);
    expect(b.detail).toContain("2026-08-24");
    expect(b.detail).toMatch(/unrecorded/i);
    expect(b.detail).not.toMatch(/undefined|null/);
  });

  it("a recorded actor is named by EMAIL", () => {
    const b = fwArchivedBanner({
      archivedAt: "2026-08-24T00:00:00Z",
      archivedBy: { kind: "email", email: "staff@the120.school" },
    });
    expect(b.detail).toContain("staff@the120.school");
    expect(b.detail).not.toMatch(/unrecorded/i);
  });

  it("a RECORDED actor whose email lookup failed is 'unresolvable', never 'unrecorded'", () => {
    // The third state the review demanded: the row holds an actor; only the naming
    // failed. Calling that "unrecorded" would misstate a fact the database has.
    const b = fwArchivedBanner({
      archivedAt: "2026-08-24T00:00:00Z",
      archivedBy: { kind: "unresolvable" },
    });
    expect(b.detail).toMatch(/couldn't name/i);
    expect(b.detail).not.toMatch(/unrecorded/i);
  });
});

describe("fwSlugTakenCopy — the archived-list pointer is a tested string", () => {
  it("names the ARCHIVED list and the unarchive path", () => {
    const copy = fwSlugTakenCopy("boston-2026-08");
    expect(copy).toContain("boston-2026-08");
    expect(copy).toMatch(/archived/i);
    expect(copy).toMatch(/unarchive/i);
  });
});

describe("fwOpsCohortAffordances — the rendering twin of Unit 8's guard table", () => {
  it("ACTIVE: everything renders, no unarchive control", () => {
    const a = fwOpsCohortAffordances({ archived: false });
    expect(a).toEqual({
      boardTokenPanel: true,
      csvImportLink: true,
      matchResolver: true,
      guideProvisionForm: true,
      guideRevoke: true,
      studentAnonymize: true,
      replayRejects: true,
      importExceptions: true,
      unarchiveControl: false,
    });
  });

  it("ARCHIVED: roster-building hidden; obligations, de-escalation and the token panel stay", () => {
    const a = fwOpsCohortAffordances({ archived: true });
    // The three roster-builders go dark…
    expect(a.csvImportLink).toBe(false);
    expect(a.matchResolver).toBe(false);
    expect(a.guideProvisionForm).toBe(false);
    // …the never-removed set is TYPED `true` (a literal, not boolean — turning any
    // of these off is a compile error, which is the point):
    expect(a.boardTokenPanel).toBe(true);
    expect(a.guideRevoke).toBe(true);
    expect(a.studentAnonymize).toBe(true);
    expect(a.replayRejects).toBe(true);
    expect(a.importExceptions).toBe(true);
    expect(a.unarchiveControl).toBe(true);
  });
});

describe("fwArchiveConfirmMatches", () => {
  it("exact slug (whitespace-trimmed) confirms; anything else does not", () => {
    expect(fwArchiveConfirmMatches("boston-2026-08", "boston-2026-08")).toBe(true);
    expect(fwArchiveConfirmMatches("  boston-2026-08  ", "boston-2026-08")).toBe(true);
    expect(fwArchiveConfirmMatches("boston", "boston-2026-08")).toBe(false);
    expect(fwArchiveConfirmMatches("BOSTON-2026-08", "boston-2026-08")).toBe(false);
    expect(fwArchiveConfirmMatches("", "boston-2026-08")).toBe(false);
  });
});
