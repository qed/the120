import { describe, expect, it } from "vitest";
import {
  admitCapture,
  applyUploadOutcome,
  AUTO_RETRY_ATTEMPT_CEILING,
  buildConfirmParams,
  buildSubmitParams,
  clampToNow,
  classifyUploadFreshness,
  decideDurabilityWarning,
  entryDisplayState,
  interpretAttachFailure,
  interpretSubmitRefusal,
  isRecognizedEntry,
  isTombstoneReason,
  nextMediaStep,
  OFFLINE_URL,
  planDrain,
  planSubmitTransitions,
  QUEUE_ENTRY_SCHEMA_VERSION,
  routeStateReadFailure,
  selectDrainable,
  shouldRegisterServiceWorker,
  SIGNED_UPLOAD_TOKEN_TTL_MS,
  summarizeQueue,
  SW_SCOPE,
  SW_URL,
  TOKEN_REMINT_MARGIN_MS,
  TOMBSTONE_REASONS,
  type LinkQueueEntry,
  type LogQueueEntry,
  type MediaQueueEntry,
  type QueueEntry,
  type SubmitQueueEntry,
} from "../sync-rules";
import { TUS_URL_TTL_MS } from "../upload-rules";

// ── fixtures ──────────────────────────────────────────────────────────────────

const T0 = Date.parse("2026-07-22T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const base = () => ({
  id: "e1",
  schemaVersion: QUEUE_ENTRY_SCHEMA_VERSION,
  studentId: "11111111-1111-4111-8111-111111111111",
  taskId: "1.1.1",
  enqueuedAt: iso(T0),
  attempts: 0,
  lastAttemptAt: null,
  blocked: null,
});

function mediaEntry(overrides: Partial<MediaQueueEntry> = {}): MediaQueueEntry {
  return {
    ...base(),
    kind: "media",
    evidenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    file: new Blob(["x"]),
    fileName: "photo.jpg",
    mime: "image/jpeg",
    bytes: 1024,
    sha256: "a".repeat(64),
    capturedAt: iso(T0 - 60_000),
    durationSeconds: undefined,
    poster: null,
    slot: null,
    tus: null,
    uploadedBytes: 0,
    uploaded: false,
    ...overrides,
  };
}

function submitEntry(overrides: Partial<SubmitQueueEntry> = {}): SubmitQueueEntry {
  return {
    ...base(),
    id: "s1",
    kind: "submit",
    submittedAt: iso(T0),
    ...overrides,
  } as SubmitQueueEntry;
}

function linkEntry(overrides: Partial<LinkQueueEntry> = {}): LinkQueueEntry {
  return {
    ...base(),
    id: "l1",
    kind: "link",
    evidenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    url: "https://example.com/proof",
    caption: undefined,
    ...overrides,
  } as LinkQueueEntry;
}

function logEntry(overrides: Partial<LogQueueEntry> = {}): LogQueueEntry {
  return {
    ...base(),
    id: "g1",
    kind: "log",
    evidenceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    rows: [{ date: "2026-07-20", channel: "door" }],
    caption: undefined,
    ...overrides,
  } as LogQueueEntry;
}

// ── constants the drivers inline (parity pinned in sw-discipline.test.ts) ─────

describe("scope constants", () => {
  it("registers a /path-scoped worker served from the origin root", () => {
    // Root-served so the proxy matcher (/fp/:path*) can never gate an SW
    // update fetch; /path-scoped so a Path SW bug cannot intercept marketing.
    expect(SW_URL).toBe("/sw.js");
    expect(SW_SCOPE).toBe("/fp");
    expect(OFFLINE_URL).toBe("/offline");
  });
});

// ── enqueue admission (never queue what can never be stored) ──────────────────

describe("admitCapture", () => {
  it("admits a normal photo", () => {
    expect(admitCapture({ sizeBytes: 2 * 1024 * 1024 })).toEqual({ ok: true });
  });

  it("refuses an over-ceiling file at capture, before it ever burns queue space", () => {
    const verdict = admitCapture({ sizeBytes: 400 * 1024 * 1024 });
    expect(verdict).toEqual({ ok: false, reason: "link_overflow", cause: "too_large" });
  });

  it("refuses an over-duration video at capture", () => {
    const verdict = admitCapture({ sizeBytes: 10 * 1024 * 1024, durationSeconds: 400 });
    expect(verdict).toEqual({ ok: false, reason: "link_overflow", cause: "too_long" });
  });
});

// ── skew clamping (plan scenario: future capturedAt clamped, recorded) ────────

describe("clampToNow", () => {
  it("passes a past timestamp through unclamped", () => {
    const r = clampToNow(iso(T0 - 5000), T0);
    expect(r).toEqual({ value: iso(T0 - 5000), clamped: false });
  });

  it("clamps a future timestamp to now and records the original", () => {
    const r = clampToNow(iso(T0 + 90_000), T0);
    expect(r).toEqual({ value: iso(T0), clamped: true, original: iso(T0 + 90_000) });
  });

  it("treats an unparseable timestamp as now, recorded", () => {
    const r = clampToNow("not-a-date", T0);
    expect(r).toEqual({ value: iso(T0), clamped: true, original: "not-a-date" });
  });

  it("clamps an absurd-past timestamp (dead-RTC 1970 reset) to now, recorded — the permanent record carries the anomaly, not the fiction", () => {
    const r = clampToNow("1970-01-01T00:00:07.000Z", T0);
    expect(r).toEqual({ value: iso(T0), clamped: true, original: "1970-01-01T00:00:07.000Z" });
  });

  it("an ordinary past timestamp above the floor is untouched", () => {
    const r = clampToNow("2026-01-15T10:00:00.000Z", T0);
    expect(r).toEqual({ value: "2026-01-15T10:00:00.000Z", clamped: false });
  });
});

// ── upload freshness (the U9 carry: 2h token vs 24h TUS URL) ──────────────────

describe("classifyUploadFreshness", () => {
  it("is fresh right after mint", () => {
    expect(classifyUploadFreshness({ slotMintedAtMs: T0, tusCreatedAtMs: T0, nowMs: T0 + 60_000 })).toBe("fresh");
  });

  it("goes token_stale before the 2h token expiry (re-mint margin)", () => {
    const nowMs = T0 + SIGNED_UPLOAD_TOKEN_TTL_MS - TOKEN_REMINT_MARGIN_MS + 1;
    expect(classifyUploadFreshness({ slotMintedAtMs: T0, tusCreatedAtMs: T0, nowMs })).toBe("token_stale");
  });

  it("a >2h pause re-mints the token but keeps the TUS URL (resume, not restart)", () => {
    const nowMs = T0 + 3 * 60 * 60 * 1000; // 3h — token dead, URL alive
    expect(classifyUploadFreshness({ slotMintedAtMs: T0, tusCreatedAtMs: T0, nowMs })).toBe("token_stale");
  });

  it("a TUS URL at or past 24h is url_expired — restart from zero (wired to isTusUrlExpired)", () => {
    const nowMs = T0 + TUS_URL_TTL_MS;
    expect(classifyUploadFreshness({ slotMintedAtMs: nowMs - 1000, tusCreatedAtMs: T0, nowMs })).toBe("url_expired");
  });

  it("no slot yet means token_stale (mint first)", () => {
    expect(classifyUploadFreshness({ slotMintedAtMs: null, tusCreatedAtMs: null, nowMs: T0 })).toBe("token_stale");
  });

  it("the exact re-mint boundary: one ms before is fresh, AT the threshold is stale (>= not >)", () => {
    const threshold = T0 + SIGNED_UPLOAD_TOKEN_TTL_MS - TOKEN_REMINT_MARGIN_MS;
    expect(classifyUploadFreshness({ slotMintedAtMs: T0, tusCreatedAtMs: null, nowMs: threshold - 1 })).toBe("fresh");
    expect(classifyUploadFreshness({ slotMintedAtMs: T0, tusCreatedAtMs: null, nowMs: threshold })).toBe("token_stale");
  });

  it("a mintedAt in the FUTURE is stale — mixed/moved clocks fail toward a cheap re-mint, never a token judged fresh forever", () => {
    expect(classifyUploadFreshness({ slotMintedAtMs: T0 + 60_000, tusCreatedAtMs: null, nowMs: T0 })).toBe(
      "token_stale"
    );
  });
});

// ── media pipeline stepping ───────────────────────────────────────────────────

describe("nextMediaStep", () => {
  it("mints when no slot exists", () => {
    expect(nextMediaStep(mediaEntry(), T0)).toEqual({ step: "mint", reset: false });
  });

  it("uploads (no resume) with a fresh slot and no TUS URL", () => {
    const e = mediaEntry({ slot: freshSlot() });
    expect(nextMediaStep(e, T0 + 1000)).toEqual({ step: "upload", resumeUrl: null });
  });

  it("resumes with a fresh slot and a live TUS URL", () => {
    const e = mediaEntry({ slot: freshSlot(), tus: { url: "https://tus/abc", createdAt: iso(T0) } });
    expect(nextMediaStep(e, T0 + 1000)).toEqual({ step: "upload", resumeUrl: "https://tus/abc" });
  });

  it("re-mints (keeping the URL) when only the token went stale", () => {
    const e = mediaEntry({ slot: freshSlot(), tus: { url: "https://tus/abc", createdAt: iso(T0) } });
    const nowMs = T0 + 3 * 60 * 60 * 1000;
    expect(nextMediaStep(e, nowMs)).toEqual({ step: "mint", reset: false });
  });

  it("plan scenario: a TUS URL past 24h restarts rather than resuming into a 404", () => {
    const e = mediaEntry({
      slot: { ...freshSlot(), mintedAt: iso(T0 + TUS_URL_TTL_MS - 1000) },
      tus: { url: "https://tus/abc", createdAt: iso(T0) },
      uploadedBytes: 12 * 1024 * 1024,
    });
    expect(nextMediaStep(e, T0 + TUS_URL_TTL_MS)).toEqual({ step: "mint", reset: true });
  });

  it("plan scenario: a completed-but-unconfirmed upload goes straight to confirm — no re-upload, no wedge", () => {
    const e = mediaEntry({ uploaded: true });
    expect(nextMediaStep(e, T0)).toEqual({ step: "confirm" });
  });

  it("uploads the poster (best-effort, once) after the clip and before confirm", () => {
    const e = mediaEntry({
      uploaded: true,
      poster: { blob: new Blob(["p"]), sha256: "b".repeat(64), uploaded: false, attempted: false, objectPath: null },
    });
    expect(nextMediaStep(e, T0)).toEqual({ step: "poster" });
  });

  it("a failed poster attempt never blocks confirm", () => {
    const e = mediaEntry({
      uploaded: true,
      poster: { blob: new Blob(["p"]), sha256: "b".repeat(64), uploaded: false, attempted: true, objectPath: null },
    });
    expect(nextMediaStep(e, T0)).toEqual({ step: "confirm" });
  });
});

function freshSlot() {
  return {
    strategy: "tus" as const,
    bucket: "path-evidence",
    objectPath: "11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aa.jpg",
    token: "tok",
    endpoint: "https://ref.storage.supabase.co/storage/v1/upload/resumable",
    chunkSize: 6 * 1024 * 1024,
    mintedAt: iso(T0),
  };
}

describe("applyUploadOutcome", () => {
  it("marks uploaded on success", () => {
    const e = applyUploadOutcome(mediaEntry({ slot: freshSlot() }), "success");
    expect(e.uploaded).toBe(true);
  });

  it("plan scenario: already-exists on a retry maps to success upstream and lands here as uploaded — the 48h-wedge fix", () => {
    // interpretUploadResponse (upload-rules) maps the duplicate signal on either
    // leg to "success"; the entry then steps to confirm, never re-uploads.
    const e = applyUploadOutcome(mediaEntry({ slot: freshSlot() }), "success");
    expect(nextMediaStep(e, T0)).toEqual({ step: "confirm" });
  });

  it("a retryable outcome stays un-uploaded and counts the attempt", () => {
    const e = applyUploadOutcome(mediaEntry({ slot: freshSlot() }), "retry");
    expect(e.uploaded).toBe(false);
    expect(e.attempts).toBe(1);
  });
});

// ── drain planning (plan scenario: items sync in order; submit waits) ─────────

describe("planDrain", () => {
  it("plan scenario: three queued items run in enqueue order", () => {
    const entries: QueueEntry[] = [
      mediaEntry({ id: "m1", enqueuedAt: iso(T0) }),
      linkEntry({ id: "l1", enqueuedAt: iso(T0 + 1000) }),
      logEntry({ id: "g1", enqueuedAt: iso(T0 + 2000) }),
    ];
    expect(planDrain(entries).runnable).toEqual(["m1", "l1", "g1"]);
  });

  it("holds a submit while earlier evidence for the same task is still pending", () => {
    const entries: QueueEntry[] = [
      mediaEntry({ id: "m1", taskId: "1.1.1", enqueuedAt: iso(T0) }),
      submitEntry({ id: "s1", taskId: "1.1.1", enqueuedAt: iso(T0 + 1000) }),
    ];
    const plan = planDrain(entries);
    expect(plan.runnable).toEqual(["m1"]);
    expect(plan.held).toEqual([{ id: "s1", reason: "awaiting_evidence" }]);
  });

  it("runs the submit once the task's evidence has cleared the queue", () => {
    const entries: QueueEntry[] = [submitEntry({ id: "s1", taskId: "1.1.1" })];
    expect(planDrain(entries).runnable).toEqual(["s1"]);
  });

  it("a submit for a DIFFERENT task is not held by another task's evidence", () => {
    const entries: QueueEntry[] = [
      mediaEntry({ id: "m1", taskId: "1.1.1", enqueuedAt: iso(T0) }),
      submitEntry({ id: "s2", taskId: "1.1.2", enqueuedAt: iso(T0 + 1000) }),
    ];
    expect(planDrain(entries).runnable).toEqual(["m1", "s2"]);
  });

  it("blocked entries are excluded from runnable, and a same-task submit is held on them", () => {
    const entries: QueueEntry[] = [
      mediaEntry({ id: "m1", taskId: "1.1.1", blocked: { reason: "forbidden", note: "n" } }),
      submitEntry({ id: "s1", taskId: "1.1.1", enqueuedAt: iso(T0 + 1000) }),
    ];
    const plan = planDrain(entries);
    expect(plan.runnable).toEqual([]);
    expect(plan.held).toEqual([{ id: "s1", reason: "needs_attention_first" }]);
  });

  it("adversarial: a clock correction that makes the submit's enqueuedAt EARLIER than its own evidence still holds it — queue membership, not wall-clock, is the invariant", () => {
    const entries: QueueEntry[] = [
      // NTP rollback between capture and submit: the media entry carries a
      // LATER wall-clock stamp than the submit that depends on it.
      mediaEntry({ id: "m1", taskId: "1.1.1", enqueuedAt: iso(T0 + 60_000) }),
      submitEntry({ id: "s1", taskId: "1.1.1", enqueuedAt: iso(T0) }),
    ];
    const plan = planDrain(entries);
    expect(plan.runnable).toEqual(["m1"]);
    expect(plan.held).toEqual([{ id: "s1", reason: "awaiting_evidence" }]);
  });

  it("an entry past the auto-retry ceiling is held as stuck — manual drains lift it", () => {
    const stuck = mediaEntry({ id: "m1", attempts: AUTO_RETRY_ATTEMPT_CEILING });
    expect(planDrain([stuck])).toEqual({ runnable: [], held: [{ id: "m1", reason: "stuck" }] });
    expect(planDrain([stuck], { includeStuck: true }).runnable).toEqual(["m1"]);
  });
});

describe("entryDisplayState", () => {
  it("splits pending / still_trying / attention honestly", () => {
    expect(entryDisplayState({ attempts: 0, blocked: null })).toBe("pending");
    expect(entryDisplayState({ attempts: AUTO_RETRY_ATTEMPT_CEILING, blocked: null })).toBe("still_trying");
    expect(entryDisplayState({ attempts: 0, blocked: { reason: "forbidden", note: "n" } })).toBe("attention");
  });
});

describe("tombstone reasons", () => {
  it("tombstones (dropped/noted/phase_locked/unrecognized) only dismiss; typed refusals can retry", () => {
    for (const reason of Object.values(TOMBSTONE_REASONS)) {
      expect(isTombstoneReason(reason)).toBe(true);
    }
    expect(isTombstoneReason("forbidden")).toBe(false);
    expect(isTombstoneReason("quota_exceeded")).toBe(false);
  });
});

// ── the rebase, not a replay (Decision 10 — the four cases, each explicit) ────

describe("planSubmitTransitions (the rebase table)", () => {
  it("case 1 — task returned to not_yet while offline: attach held, submit re-applies via resume", () => {
    expect(planSubmitTransitions("not_yet")).toEqual({ kind: "chain", transitions: ["resume", "submit"] });
  });

  it("case 3 — phase (or predecessor) locked: submit refused with a student-readable explanation", () => {
    const plan = planSubmitTransitions("locked");
    expect(plan.kind).toBe("refused");
    if (plan.kind === "refused") {
      expect(plan.note).toMatch(/isn.t open|locked|earlier/i);
    }
  });

  it("case 4 — task verified while offline: done quietly, celebration replayed, NEVER an error", () => {
    const plan = planSubmitTransitions("verified");
    expect(plan).toEqual({
      kind: "done",
      celebrate: true,
      note: expect.stringMatching(/verified/i),
    });
  });

  it("a task still available chains open before submit (the offline open never landed)", () => {
    expect(planSubmitTransitions("available")).toEqual({ kind: "chain", transitions: ["open", "submit"] });
  });

  it("in_progress submits directly", () => {
    expect(planSubmitTransitions("in_progress")).toEqual({ kind: "chain", transitions: ["submit"] });
  });

  it("already submitted resolves quietly (an earlier drain or another device won)", () => {
    expect(planSubmitTransitions("submitted")).toEqual({ kind: "done", celebrate: false, note: null });
  });

  it("plan scenario: a task that no longer exists drops with a surfaced note, never silently", () => {
    const plan = planSubmitTransitions(null);
    expect(plan.kind).toBe("drop");
    // The REAL student-readable copy, not just non-empty (testing review).
    if (plan.kind === "drop") expect(plan.note).toMatch(/no longer exists/i);
  });
});

describe("interpretSubmitRefusal", () => {
  it("case 2 — criterion returned (display_blocked): submit no-ops with a note, evidence stays attached", () => {
    expect(interpretSubmitRefusal("display_blocked")).toEqual({
      outcome: "done_with_note",
      note: expect.stringMatching(/earlier step|reopened/i),
    });
  });

  it("transient refusals retry", () => {
    expect(interpretSubmitRefusal("unavailable")).toEqual({ outcome: "retry" });
    expect(interpretSubmitRefusal("rate_limited")).toEqual({ outcome: "retry" });
  });

  it("an expired session pauses the drain for re-auth (never burns the entry)", () => {
    expect(interpretSubmitRefusal("login")).toEqual({ outcome: "auth" });
  });

  it("an unknown refusal blocks with a note — fail closed, never an infinite retry", () => {
    const r = interpretSubmitRefusal("some_new_reason");
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") expect(r.note).toMatch(/couldn't be sent/i);
  });
});

describe("routeStateReadFailure (the rebase's state-read failure table)", () => {
  it("not_found routes to the task-missing rebase case", () => {
    expect(routeStateReadFailure("not_found")).toEqual({ outcome: "task_missing" });
  });

  it("forbidden is TERMINAL — a grant change while queued must never spin as a transparent retry forever", () => {
    const r = routeStateReadFailure("forbidden");
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") expect(r.note).toMatch(/can't be sent/i);
  });

  it("transient reasons retry; login pauses for re-auth", () => {
    expect(routeStateReadFailure("unavailable")).toEqual({ outcome: "retry" });
    expect(routeStateReadFailure("invalid")).toEqual({ outcome: "retry" });
    expect(routeStateReadFailure("login")).toEqual({ outcome: "auth" });
  });
});

// Plan scenario 7 note: "a submit whose response was lost but committed is
// detected on re-read, not double-applied" is applyTransition's own contract
// (U8: lost echo → re-read → ok byCaller:false; tested in progress-core). The
// engine's obligation — treat ANY ok as done, never re-apply — is inline where
// the chain runs; planSubmitTransitions("submitted") → done covers the
// next-drain replay above.

// ── attach failures ───────────────────────────────────────────────────────────

describe("interpretAttachFailure", () => {
  it("plan scenario: a queued item whose task no longer exists is dropped with a surfaced note", () => {
    const r = interpretAttachFailure("media", "not_found");
    expect(r.outcome).toBe("drop");
    if (r.outcome === "drop") expect(r.note).toMatch(/no longer exists/i);
  });

  it("a log queued against a since-verified task resolves with a note (append-only froze it)", () => {
    const r = interpretAttachFailure("log", "append_only");
    expect(r.outcome).toBe("done_with_note");
    if (r.outcome === "done_with_note") expect(r.note).toMatch(/verified/i);
  });

  it("transient failures retry; auth pauses", () => {
    expect(interpretAttachFailure("media", "unavailable")).toEqual({ outcome: "retry" });
    expect(interpretAttachFailure("link", "login")).toEqual({ outcome: "auth" });
  });

  it("terminal refusals block with a student-readable note", () => {
    const r = interpretAttachFailure("media", "quota_exceeded");
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") expect(r.note).toMatch(/storage is full/i);
  });
});

// ── replay identity (plan scenario: same item twice yields one row) ───────────

describe("buildConfirmParams", () => {
  it("reuses the SAME evidenceId on every replay — the quota exclusion and confirm idempotency key on it", () => {
    const e = { ...mediaEntry({ uploaded: true }), slot: freshSlot() };
    const a = buildConfirmParams(e, T0);
    const b = buildConfirmParams(e, T0 + 60_000);
    expect(a.evidenceId).toBe(e.evidenceId);
    expect(b.evidenceId).toBe(e.evidenceId);
    expect(a.objectPath).toBe(e.slot.objectPath);
  });

  it("clamps a future capturedAt and records the clamp in the private exif field", () => {
    const e = { ...mediaEntry({ uploaded: true, capturedAt: iso(T0 + 120_000) }), slot: freshSlot() };
    const p = buildConfirmParams(e, T0);
    expect(p.capturedAt).toBe(iso(T0));
    expect(p.exif).toEqual({
      clock_skew_clamped: { original_captured_at: iso(T0 + 120_000), clamped_at: iso(T0) },
    });
  });

  it("passes an honest past capturedAt through untouched, with no exif record", () => {
    const e = { ...mediaEntry({ uploaded: true }), slot: freshSlot() };
    const p = buildConfirmParams(e, T0);
    expect(p.capturedAt).toBe(e.capturedAt);
    expect(p.exif).toBeUndefined();
  });
});

// ── R30 (plan integration scenario) ───────────────────────────────────────────

describe("buildSubmitParams", () => {
  it("submitted_at is the ENQUEUE-time client value — it diverges from submit_received_at by the offline duration; R30 instruments off the server value", () => {
    const e = submitEntry({ submittedAt: iso(T0) });
    const threeDays = T0 + 3 * 24 * 60 * 60 * 1000;
    expect(buildSubmitParams(e, threeDays)).toEqual({ submittedAt: iso(T0), clamp: null });
  });

  it("clamps a future submittedAt (client clock skew) and records it", () => {
    const e = submitEntry({ submittedAt: iso(T0 + 600_000) });
    expect(buildSubmitParams(e, T0)).toEqual({
      submittedAt: iso(T0),
      clamp: { original: iso(T0 + 600_000) },
    });
  });
});

// ── registration guard (preview SWs must not poison) ──────────────────────────

describe("shouldRegisterServiceWorker", () => {
  it("registers on the production hostname and localhost", () => {
    expect(shouldRegisterServiceWorker("the120.school")).toBe(true);
    expect(shouldRegisterServiceWorker("www.the120.school")).toBe(true);
    expect(shouldRegisterServiceWorker("localhost")).toBe(true);
    expect(shouldRegisterServiceWorker("127.0.0.1")).toBe(true);
  });

  it("never registers on a preview or alias deployment", () => {
    expect(shouldRegisterServiceWorker("jointhe120.vercel.app")).toBe(false);
    expect(shouldRegisterServiceWorker("the120-git-feat-x-qed.vercel.app")).toBe(false);
    expect(shouldRegisterServiceWorker("evil-the120.school.example.com")).toBe(false);
  });
});

// ── iOS durability posture (install is a data-durability requirement) ─────────

describe("decideDurabilityWarning", () => {
  it("is silent for an installed app or a non-iOS browser", () => {
    expect(decideDurabilityWarning({ isIOS: true, isStandalone: true, queuedCount: 3 })).toBe("none");
    expect(decideDurabilityWarning({ isIOS: false, isStandalone: false, queuedCount: 3 })).toBe("none");
  });

  it("gently coaches install on non-installed iOS with nothing queued", () => {
    expect(decideDurabilityWarning({ isIOS: true, isStandalone: false, queuedCount: 0 })).toBe("install_gentle");
  });

  it("warns LOUDLY when queued bytes exist on non-installed iOS — the 7-day wipe eats them", () => {
    expect(decideDurabilityWarning({ isIOS: true, isStandalone: false, queuedCount: 1 })).toBe("install_urgent");
  });
});

// ── drainable scoping (a shared family tablet holds siblings' entries) ────────

describe("selectDrainable", () => {
  it("drains only entries the signed-in session can act on; a sibling's stay queued, never blocked", () => {
    const mine = mediaEntry({ id: "m1", studentId: "11111111-1111-4111-8111-111111111111" });
    const sibling = mediaEntry({
      id: "m2",
      studentId: "22222222-2222-4222-8222-222222222222",
      evidenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    expect(selectDrainable([mine, sibling], ["11111111-1111-4111-8111-111111111111"]).map((e) => e.id)).toEqual([
      "m1",
    ]);
  });

  it("a parent session (multiple actable children) drains all of them", () => {
    const a = mediaEntry({ id: "m1", studentId: "11111111-1111-4111-8111-111111111111" });
    const b = mediaEntry({
      id: "m2",
      studentId: "22222222-2222-4222-8222-222222222222",
      evidenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    expect(
      selectDrainable([a, b], [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]).map((e) => e.id)
    ).toEqual(["m1", "m2"]);
  });
});

// ── SyncStatus view model ─────────────────────────────────────────────────────

describe("summarizeQueue", () => {
  it("counts pending work, surfaces attention items, and counts BLOCKED media bytes too — a stuck 45MB video is exactly as exposed to the 7-day wipe as a pending one", () => {
    const entries: QueueEntry[] = [
      mediaEntry({ id: "m1", bytes: 1000 }),
      linkEntry({ id: "l1" }),
      mediaEntry({
        id: "m2",
        bytes: 2000,
        evidenceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        blocked: { reason: "quota_exceeded", note: "Storage is full" },
      }),
    ];
    const s = summarizeQueue(entries);
    expect(s.pendingCount).toBe(2);
    // 1000 pending + 2000 blocked: the durability banner must never
    // understate the at-risk bytes (adversarial review).
    expect(s.queuedBytes).toBe(3000);
    expect(s.attention).toEqual([{ id: "m2", note: "Storage is full" }]);
  });

  it("an empty queue summarizes to zero, no attention", () => {
    expect(summarizeQueue([])).toEqual({ pendingCount: 0, queuedBytes: 0, attention: [] });
  });
});

describe("isRecognizedEntry (cross-deploy tolerant reader)", () => {
  it("recognizes every current entry kind", () => {
    expect(isRecognizedEntry(mediaEntry())).toBe(true);
    expect(isRecognizedEntry(linkEntry())).toBe(true);
    expect(isRecognizedEntry(logEntry())).toBe(true);
    expect(isRecognizedEntry(submitEntry())).toBe(true);
  });

  it("tolerates a missing schemaVersion (entries written before the field existed are v1)", () => {
    const { schemaVersion, ...legacy } = mediaEntry();
    void schemaVersion;
    expect(isRecognizedEntry(legacy)).toBe(true);
  });

  it("refuses a future schema version, an unknown kind, and junk — never fed raw into the drain", () => {
    expect(isRecognizedEntry({ ...mediaEntry(), schemaVersion: QUEUE_ENTRY_SCHEMA_VERSION + 1 })).toBe(false);
    expect(isRecognizedEntry({ ...mediaEntry(), kind: "hologram" })).toBe(false);
    expect(isRecognizedEntry(null)).toBe(false);
    expect(isRecognizedEntry("garbage")).toBe(false);
    expect(isRecognizedEntry({})).toBe(false);
  });
});
