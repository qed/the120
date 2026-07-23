import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  MAX_SEND_ATTEMPTS,
  NOTIFICATION_EVENT_KINDS,
  NUDGE_DEFAULT_THRESHOLD_HOURS,
  SEND_KINDS,
  buildNudgeSends,
  dueNudges,
  idempotencyKeyFor,
  interpretClaim,
  interpretSendClaimMiss,
  isSendDue,
  mergePlans,
  nudgeSourceKey,
  planForReview,
  planForTaskEvent,
  reconcilePlan,
  reviewOpenedKey,
  reviewReturnedKey,
  sendDedupeKey,
  sendUnclaimOutcome,
  supersedePlan,
  taskEventKey,
  type NotificationPlan,
  type ParentRecipient,
  type ReviewInput,
  type TaskEventInput,
} from "../notify-rules";

/* ─────────────────────────────────────────────────────────── fixtures */

const STUDENT = "11111111-1111-1111-1111-111111111111";
const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REVIEW = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MUM: ParentRecipient = { userId: "22222222-2222-2222-2222-222222222222", email: "mum@example.invalid" };
const DAD: ParentRecipient = { userId: "33333333-3333-3333-3333-333333333333", email: "dad@example.invalid" };

function taskEvent(overrides: Partial<TaskEventInput> = {}): TaskEventInput {
  return {
    id: EVENT,
    studentId: STUDENT,
    taskId: "1.1.1",
    transition: "submit",
    note: null,
    ...overrides,
  };
}

const CTX = {
  parents: [MUM, DAD],
  studentFirstName: "Maya",
  taskTitle: "Make your pitch",
  doneWhen: "You said the words out loud to a real person.",
};

function emptyPlan(): NotificationPlan {
  return { events: [], sends: [] };
}

/* ─────────────────────────────────────────────────────────── glob canary */

describe("glob canary", () => {
  it("this directory is discovered by the vitest include allowlist", () => {
    // Verified failing first under `npm run test` (Unit 2 discipline), then
    // inverted: the allowlist glob app/path/**/__tests__/** reaches notify/.
    expect(true).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────── dedupe keys */

describe("dedupe keys", () => {
  it("are stable and mutually distinct across sources", () => {
    expect(taskEventKey(EVENT)).toBe(taskEventKey(EVENT));
    const keys = [
      taskEventKey(EVENT),
      reviewOpenedKey(REVIEW),
      reviewReturnedKey(REVIEW),
      nudgeSourceKey("tp-1", "2026-07-22T10:00:00.000Z"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("send keys append the recipient so two parents never collide", () => {
    const a = sendDedupeKey(taskEventKey(EVENT), MUM.userId);
    const b = sendDedupeKey(taskEventKey(EVENT), DAD.userId);
    expect(a).not.toBe(b);
    expect(a).toContain(MUM.userId);
  });

  it("the Resend idempotency key is a stable function of the dedupe key", () => {
    const key = sendDedupeKey(taskEventKey(EVENT), MUM.userId);
    // Stable across retries — a fresh key each attempt would defeat the 24h
    // provider dedupe (retry-transient-send-failures learning).
    expect(idempotencyKeyFor(key)).toBe(idempotencyKeyFor(key));
    expect(idempotencyKeyFor(key)).toContain(key);
  });
});

/* ─────────────────────────────────────────── plan derivation: task events */

describe("planForTaskEvent", () => {
  it("submit → exactly one pending send per parent, no student event", () => {
    const plan = planForTaskEvent(taskEvent({ transition: "submit" }), CTX);
    expect(plan.events).toEqual([]);
    expect(plan.sends).toHaveLength(2);
    const keys = plan.sends.map((s) => s.dedupeKey);
    expect(new Set(keys).size).toBe(2);
    for (const send of plan.sends) {
      expect(send.kind).toBe("submitted");
      expect(send.studentId).toBe(STUDENT);
      expect(send.params).toMatchObject({
        studentFirstName: "Maya",
        taskId: "1.1.1",
        taskTitle: "Make your pitch",
      });
    }
    expect(plan.sends.map((s) => s.recipientUserId).sort()).toEqual(
      [MUM.userId, DAD.userId].sort()
    );
  });

  it("a parent with no email is skipped, never a null-recipient row", () => {
    const plan = planForTaskEvent(taskEvent({ transition: "submit" }), {
      ...CTX,
      parents: [MUM, { userId: DAD.userId, email: null }],
    });
    expect(plan.sends).toHaveLength(1);
    expect(plan.sends[0].recipientUserId).toBe(MUM.userId);
  });

  it("verify → one in-app student event, NO email attempted (the under-13 guarantee)", () => {
    const plan = planForTaskEvent(taskEvent({ transition: "verify", note: "Proud of you" }), CTX);
    expect(plan.sends).toEqual([]); // structurally: student audience never produces a send
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      dedupeKey: taskEventKey(EVENT),
      studentId: STUDENT,
      kind: "verified",
      taskId: "1.1.1",
      params: { taskId: "1.1.1", note: "Proud of you" },
    });
  });

  it("not_yet → an in-app event carrying the required note", () => {
    const plan = planForTaskEvent(taskEvent({ transition: "not_yet", note: "One more rep" }), CTX);
    expect(plan.sends).toEqual([]);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].kind).toBe("not_yet");
    expect(plan.events[0].params).toMatchObject({ note: "One more rep" });
  });

  it("revoke → a `reopened` event (Unit 16 renders it past-tense beside the original)", () => {
    const plan = planForTaskEvent(taskEvent({ transition: "revoke", note: "Took another look" }), CTX);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].kind).toBe("reopened");
  });

  it("mechanical transitions produce no notifications at all", () => {
    for (const transition of ["unlock", "open", "withdraw", "resume"]) {
      expect(planForTaskEvent(taskEvent({ transition }), CTX)).toEqual(emptyPlan());
    }
  });

  it("criterion_return task events are silent here — the review row carries that ceremony", () => {
    // One ceremony = one student notification (keyed off the review row), not
    // one per returned task; planForReview owns it.
    expect(planForTaskEvent(taskEvent({ transition: "criterion_return" }), CTX)).toEqual(emptyPlan());
  });

  it("an unknown transition plans nothing rather than throwing (fail quiet-but-logged upstream)", () => {
    expect(planForTaskEvent(taskEvent({ transition: "sparkle" }), CTX)).toEqual(emptyPlan());
  });
});

/* ─────────────────────────────────────────────── plan derivation: reviews */

describe("planForReview", () => {
  function review(overrides: Partial<ReviewInput> = {}): ReviewInput {
    return {
      id: REVIEW,
      studentId: STUDENT,
      scope: "criterion",
      scopeId: "1.1",
      attempt: 1,
      state: "review_underway",
      note: null,
      ...overrides,
    };
  }

  it("review_underway → the student learns the landmark entered review", () => {
    const plan = planForReview(review());
    expect(plan.sends).toEqual([]);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      dedupeKey: reviewOpenedKey(REVIEW),
      kind: "review_underway",
      scopeId: "1.1",
    });
  });

  it("returned → a criterion_returned event carrying the reviewer's note", () => {
    const plan = planForReview(review({ state: "returned", note: "Redo the ledger" }));
    // BOTH the opened and the returned event are planned — a return implies the
    // open happened; reconcile inserts whichever is missing (dedupe keys differ).
    expect(plan.events).toHaveLength(2);
    const returned = plan.events.find((e) => e.kind === "criterion_returned");
    expect(returned).toMatchObject({
      dedupeKey: reviewReturnedKey(REVIEW),
      scopeId: "1.1",
      params: { criterionId: "1.1", note: "Redo the ledger" },
    });
  });

  it("cleared (a T2 outcome) and phase scope plan nothing in T1", () => {
    expect(planForReview(review({ state: "cleared" })).events).toEqual([]);
    expect(planForReview(review({ scope: "phase", scopeId: "01" }))).toEqual(emptyPlan());
  });
});

/* ─────────────────────────────────────────────────────── supersede rules */

describe("supersedePlan", () => {
  const live = [
    { id: "e1", kind: "verified", taskId: "1.1.1", scopeId: null, supersededAt: null },
    { id: "e2", kind: "verified", taskId: "1.1.2", scopeId: null, supersededAt: null },
    { id: "e3", kind: "review_underway", taskId: null, scopeId: "1.1", supersededAt: null },
    { id: "e4", kind: "verified", taskId: "1.1.1", scopeId: null, supersededAt: "2026-07-20T00:00:00Z" },
    { id: "e5", kind: "not_yet", taskId: "1.1.1", scopeId: null, supersededAt: null },
  ];

  it("a reopened task supersedes ONLY that task's live verified events", () => {
    const ids = supersedePlan({ kind: "reopened", taskId: "1.1.1" }, live);
    expect(ids).toEqual(["e1"]); // e4 already superseded; e2 is another task; e5 is not a celebration
  });

  it("a criterion return supersedes the review_underway event and the returned tasks' verified events", () => {
    const ids = supersedePlan(
      { kind: "criterion_returned", scopeId: "1.1", returnedTaskIds: ["1.1.1", "1.1.2"] },
      live
    );
    expect([...ids].sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("forward-progress kinds never supersede anything (append-only history)", () => {
    expect(supersedePlan({ kind: "verified", taskId: "1.1.1" }, live)).toEqual([]);
    expect(supersedePlan({ kind: "not_yet", taskId: "1.1.1" }, live)).toEqual([]);
  });
});

/* ────────────────────────────────────── the claim / unclaim state machine */

describe("claim-then-send state machine", () => {
  it("interpretClaim: cardinality is the verdict", () => {
    expect(interpretClaim({ errored: false, claimedRows: 1 })).toBe("claimed");
    expect(interpretClaim({ errored: false, claimedRows: 0 })).toBe("miss");
    expect(interpretClaim({ errored: true, claimedRows: 0 })).toBe("error");
    // An errored claim is an error even if the driver echoed rows — fail safe.
    expect(interpretClaim({ errored: true, claimedRows: 1 })).toBe("error");
  });

  it("a zero-row claim is disambiguated by RE-PROBING the send row, never assumed failed", () => {
    expect(interpretSendClaimMiss({ exists: true, sentAt: "2026-07-22T10:00:00.000Z" })).toEqual({
      status: "already_sent",
    });
    // Row exists, stamp null: another invocation claimed after our read and then
    // failed+unclaimed (or is mid-flight) — retry on a later run, never double-send now.
    expect(interpretSendClaimMiss({ exists: true, sentAt: null })).toEqual({
      status: "raced_retry_later",
    });
    expect(interpretSendClaimMiss({ exists: false, sentAt: null })).toEqual({
      status: "row_missing",
    });
  });

  it("the unclaim restores only when OUR stamp still holds; zero rows is superseded, not a warning", () => {
    expect(sendUnclaimOutcome({ errored: false, restoredRows: 1 })).toBe("restored");
    expect(sendUnclaimOutcome({ errored: false, restoredRows: 0 })).toBe("superseded");
    expect(sendUnclaimOutcome({ errored: true, restoredRows: 0 })).toBe("warn");
  });

  it("isSendDue: pending under the attempt ceiling only", () => {
    expect(isSendDue({ sentAt: null, attempts: 0 })).toBe(true);
    expect(isSendDue({ sentAt: null, attempts: MAX_SEND_ATTEMPTS - 1 })).toBe(true);
    expect(isSendDue({ sentAt: null, attempts: MAX_SEND_ATTEMPTS })).toBe(false); // parked loudly
    expect(isSendDue({ sentAt: "2026-07-22T10:00:00.000Z", attempts: 1 })).toBe(false);
  });
});

/* ───────────────────────────────────────────────────────── stall nudges */

describe("stall nudges", () => {
  const NOW = Date.parse("2026-07-25T12:00:00.000Z");
  const submitted = (hoursAgo: number, tp = "tp-1") => ({
    taskProgressId: tp,
    studentId: STUDENT,
    taskId: "1.1.1",
    submitReceivedAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
  });

  it("due exactly at the threshold, not before (default 72h)", () => {
    expect(NUDGE_DEFAULT_THRESHOLD_HOURS).toBe(72);
    const under = dueNudges({
      submitted: [submitted(71.9)],
      thresholdHours: NUDGE_DEFAULT_THRESHOLD_HOURS,
      existingSourceKeys: new Set(),
      nowMs: NOW,
    });
    expect(under).toEqual([]);
    const at = dueNudges({
      submitted: [submitted(72)],
      thresholdHours: NUDGE_DEFAULT_THRESHOLD_HOURS,
      existingSourceKeys: new Set(),
      nowMs: NOW,
    });
    expect(at).toHaveLength(1);
    expect(at[0].waitingHours).toBe(72);
  });

  it("honours a family-set threshold", () => {
    const due = dueNudges({
      submitted: [submitted(49)],
      thresholdHours: 48,
      existingSourceKeys: new Set(),
      nowMs: NOW,
    });
    expect(due).toHaveLength(1);
  });

  it("nudges once per submit cycle — an existing source key suppresses; a re-submit re-arms", () => {
    const first = submitted(80);
    const key = nudgeSourceKey(first.taskProgressId, first.submitReceivedAt);
    expect(
      dueNudges({
        submitted: [first],
        thresholdHours: 72,
        existingSourceKeys: new Set([key]),
        nowMs: NOW,
      })
    ).toEqual([]);
    // Withdraw → resubmit stamps a NEW submit_received_at → a fresh key → re-armed.
    const resubmitted = submitted(73);
    expect(
      dueNudges({
        submitted: [resubmitted],
        thresholdHours: 72,
        existingSourceKeys: new Set([key]),
        nowMs: NOW,
      })
    ).toHaveLength(1);
  });

  it("a row with no submit timestamp is skipped, never nudged on a guess", () => {
    expect(
      dueNudges({
        submitted: [{ taskProgressId: "tp-x", studentId: STUDENT, taskId: "1.1.1", submitReceivedAt: null }],
        thresholdHours: 72,
        existingSourceKeys: new Set(),
        nowMs: NOW,
      })
    ).toEqual([]);
  });

  it("expands one due nudge into one send per parent, dedupe-keyed per recipient", () => {
    const [due] = dueNudges({
      submitted: [submitted(80)],
      thresholdHours: 72,
      existingSourceKeys: new Set(),
      nowMs: NOW,
    });
    const sends = buildNudgeSends(due, {
      parents: [MUM, DAD],
      studentFirstName: "Maya",
      taskTitle: "Make your pitch",
    });
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((s) => s.dedupeKey)).size).toBe(2);
    for (const s of sends) {
      expect(s.kind).toBe("stall_nudge");
      expect(s.params).toMatchObject({ studentFirstName: "Maya", waitingHours: 80 });
    }
  });
});

/* ───────────────────────────────────────────────── reconcile (the healer) */

describe("reconcilePlan", () => {
  it("plans only what is missing — existing dedupe keys are skipped", () => {
    const verifyEvent = taskEvent({ transition: "verify", note: "Nice" });
    const submitEvent = taskEvent({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", transition: "submit" });
    const full = mergePlans([
      planForTaskEvent(verifyEvent, CTX),
      planForTaskEvent(submitEvent, CTX),
      planForReview({
        id: REVIEW,
        studentId: STUDENT,
        scope: "criterion",
        scopeId: "1.1",
        attempt: 1,
        state: "review_underway",
        note: null,
      }),
    ]);
    // Simulate: the verify event row and ONE parent's submit send already exist.
    const existingEventKeys = new Set([taskEventKey(EVENT)]);
    const existingSendKeys = new Set([
      sendDedupeKey(taskEventKey("cccccccc-cccc-cccc-cccc-cccccccccccc"), MUM.userId),
    ]);
    const missing = reconcilePlan(full, { existingEventKeys, existingSendKeys });
    expect(missing.events.map((e) => e.dedupeKey).sort()).toEqual([reviewOpenedKey(REVIEW)]);
    expect(missing.sends).toHaveLength(1);
    expect(missing.sends[0].recipientUserId).toBe(DAD.userId);
  });

  it("an empty world reconciles to an empty plan", () => {
    expect(
      reconcilePlan(emptyPlan(), { existingEventKeys: new Set(), existingSendKeys: new Set() })
    ).toEqual(emptyPlan());
  });
});

/* ────────────────────────────────────────── SQL / config parity (drift pins) */

describe("migration and config parity", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "20260723120000_path_notifications.sql"),
    "utf8"
  );

  /** The CREATE TABLE block for one table: from its create statement to the
   *  closing `);` — robust against prose mentions of table names elsewhere. */
  function tableBlock(name: string): string {
    const m = migration.match(
      new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`)
    );
    expect(m, `CREATE TABLE block for ${name}`).toBeTruthy();
    return m![1];
  }

  it("the events kind CHECK matches NOTIFICATION_EVENT_KINDS exactly", () => {
    const check = tableBlock("path_notification_events").match(/kind in \(([^)]+)\)/);
    expect(check, "events kind CHECK present").toBeTruthy();
    const sqlKinds = [...check![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(sqlKinds).toEqual([...NOTIFICATION_EVENT_KINDS].sort());
  });

  it("the sends kind CHECK matches SEND_KINDS exactly", () => {
    const check = tableBlock("path_notification_sends").match(/kind in \(([^)]+)\)/);
    expect(check, "sends kind CHECK present").toBeTruthy();
    const sqlKinds = [...check![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(sqlKinds).toEqual([...SEND_KINDS].sort());
  });

  it("no CASCADE anywhere in the notifications migration (RESTRICT posture, PII scope)", () => {
    expect(migration.toLowerCase()).not.toContain("on delete cascade");
  });

  it("vercel.json schedules BOTH the notification cron and the evidence reaper", () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const paths = vercel.crons.map((c) => c.path);
    expect(paths).toContain("/api/cron/path-notifications");
    expect(paths).toContain("/api/cron/path-evidence-reaper");
    // Decision 8's latency criterion leans on a tight cadence (Pro tier): the
    // notification cron runs every 10 minutes, not daily.
    const notify = vercel.crons.find((c) => c.path === "/api/cron/path-notifications");
    expect(notify?.schedule).toBe("*/10 * * * *");
  });
});
