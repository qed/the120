/**
 * Unit 4 timeline tests: `buildTimeline` merges system events (truth
 * timestamps), staff notes, and staff stage history into one desc-sorted
 * stream with unique prefixed ids (plan Decision 2 event model).
 */

import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  type TimelineChildInput,
  type TimelineDepositInput,
  type TimelineFamilyInput,
  type TimelineHistoryInput,
  type TimelineNoteInput,
} from "@/app/crm/lib/queries";

const family = (
  overrides: Partial<TimelineFamilyInput> = {}
): TimelineFamilyInput => ({
  id: "fam-1",
  signup_at: null,
  dossier_submitted_at: null,
  welcome_email_at: null,
  ...overrides,
});

const note = (id: string, ts: string, body = "Note body"): TimelineNoteInput => ({
  id,
  body,
  created_at: ts,
});

const history = (
  id: string,
  ts: string,
  overrides: Partial<TimelineHistoryInput> = {}
): TimelineHistoryInput => ({
  id,
  from_stage: null,
  to_stage: "call_booked",
  note: "stamp · 2026-07-15T12:00:00Z",
  created_at: ts,
  ...overrides,
});

const deposit = (
  id: string,
  ts: string,
  overrides: Partial<TimelineDepositInput> = {}
): TimelineDepositInput => ({
  id,
  child_id: "child-1",
  amount: 25000,
  created_at: ts,
  refunded_at: null,
  ...overrides,
});

const children: TimelineChildInput[] = [{ id: "child-1", first_name: "Maya" }];

describe("buildTimeline", () => {
  it("returns an empty array for a family with no events (R34 empty state)", () => {
    expect(buildTimeline(family(), [], [], [], [])).toEqual([]);
  });

  it("interleaves all source types sorted newest-first", () => {
    const entries = buildTimeline(
      family({
        signup_at: "2026-07-14T10:00:00Z",
        dossier_submitted_at: "2026-07-16T10:00:00Z",
        welcome_email_at: "2026-07-14T10:05:00Z",
      }),
      [note("n1", "2026-07-17T10:00:00Z")],
      [history("h1", "2026-07-15T10:00:00Z")],
      children,
      [deposit("d1", "2026-07-18T10:00:00Z")]
    );

    expect(entries.map((e) => e.type)).toEqual([
      "deposit", // Jul 18
      "note", // Jul 17
      "system", // Jul 16 dossier
      "stage", // Jul 15 stamp
      "system", // Jul 14 10:05 welcome
      "system", // Jul 14 10:00 signup
    ]);

    const timestamps = entries.map((e) => new Date(e.ts).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });

  it("gives every entry a unique, source-prefixed id", () => {
    const entries = buildTimeline(
      family({
        signup_at: "2026-07-14T10:00:00Z",
        dossier_submitted_at: "2026-07-16T10:00:00Z",
        welcome_email_at: "2026-07-14T10:05:00Z",
      }),
      [note("x", "2026-07-17T10:00:00Z")],
      [history("x", "2026-07-15T10:00:00Z")],
      children,
      [deposit("x", "2026-07-18T10:00:00Z", { refunded_at: "2026-07-19T10:00:00Z" })]
    );
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("note-x");
    expect(ids).toContain("hist-x");
    expect(ids).toContain("dep-x-paid");
    expect(ids).toContain("dep-x-refunded");
    expect(ids).toContain("sys-signup-fam-1");
  });

  it("emits BOTH paid and refunded events for a refunded deposit", () => {
    const entries = buildTimeline(
      family(),
      [],
      [],
      children,
      [
        deposit("d1", "2026-07-18T10:00:00Z", {
          refunded_at: "2026-07-20T10:00:00Z",
        }),
      ]
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].label).toContain("Deposit refunded");
    expect(entries[0].ts).toBe("2026-07-20T10:00:00Z");
    expect(entries[1].label).toContain("Deposit paid");
    expect(entries[1].label).toContain("$250");
    expect(entries[1].detail).toBe("for Maya");
    // Paid and refunded read as different dot colors.
    expect(entries[0].dotColor).not.toBe(entries[1].dotColor);
  });

  it("emits only the paid event for an unrefunded deposit", () => {
    const entries = buildTimeline(family(), [], [], children, [
      deposit("d1", "2026-07-18T10:00:00Z"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("dep-d1-paid");
  });

  it("carries a note's body as its detail", () => {
    const entries = buildTimeline(
      family(),
      [note("n1", "2026-07-17T10:00:00Z", "Spoke after the info session.")],
      [],
      [],
      []
    );
    expect(entries[0].type).toBe("note");
    expect(entries[0].detail).toBe("Spoke after the info session.");
  });

  it("labels a call-stamp history row with the stamped date", () => {
    const entries = buildTimeline(
      family(),
      [],
      [history("h1", "2026-07-15T10:00:00Z")],
      [],
      []
    );
    expect(entries[0].label).toBe("CALL BOOKED stamped");
    expect(entries[0].detail).toContain("Jul 15");
  });

  it("labels stamp-cleared, override, reopen and merge rows distinctly", () => {
    const entries = buildTimeline(
      family(),
      [],
      [
        history("h1", "2026-07-15T10:00:00Z", {
          to_stage: "call_held",
          note: "stamp-cleared",
        }),
        history("h2", "2026-07-16T10:00:00Z", {
          to_stage: "lost",
          note: "override",
        }),
        history("h3", "2026-07-17T10:00:00Z", {
          to_stage: "account_created",
          note: "reopened",
        }),
        history("h4", "2026-07-18T10:00:00Z", {
          to_stage: "interested",
          note: "merged family abc (Dana) into this record",
        }),
      ],
      [],
      []
    );
    const labels = entries.map((e) => e.label);
    expect(labels).toContain("CALL HELD stamp cleared");
    expect(labels).toContain("Marked LOST");
    expect(labels).toContain("Reopened — back to ACCOUNT CREATED");
    expect(labels).toContain("Families merged");
  });

  it("skips system events whose truth timestamp is null", () => {
    const entries = buildTimeline(
      family({ signup_at: "2026-07-14T10:00:00Z" }),
      [],
      [],
      [],
      []
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Account created");
  });

  it("breaks timestamp ties deterministically by id", () => {
    const ts = "2026-07-15T10:00:00Z";
    const a = buildTimeline(family(), [note("b", ts), note("a", ts)], [], [], []);
    const b = buildTimeline(family(), [note("a", ts), note("b", ts)], [], [], []);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });

  it("renders library sends by channel (Unit 7)", () => {
    const entries = buildTimeline(
      family(),
      [],
      [],
      [],
      [],
      [
        {
          id: "s1",
          channel: "email",
          subject: "DEPOSIT + REFUND TERMS",
          itemTitle: "DEPOSIT + REFUND TERMS",
          sent_at: "2026-07-16T10:00:00Z",
        },
        {
          id: "s2",
          channel: "other",
          subject: null,
          itemTitle: "SCREENS: THE TIN CAN IS THE ANSWER",
          sent_at: "2026-07-15T10:00:00Z",
        },
      ]
    );
    expect(entries.map((e) => e.type)).toEqual(["send", "send"]);
    expect(entries[0].label).toBe("Library send · DEPOSIT + REFUND TERMS");
    expect(entries[0].detail).toBe("DEPOSIT + REFUND TERMS");
    expect(entries[1].label).toBe(
      "Sent elsewhere · SCREENS: THE TIN CAN IS THE ANSWER"
    );
    expect(entries[1].detail).toBeUndefined();
  });
});
