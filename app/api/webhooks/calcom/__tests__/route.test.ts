/**
 * Unit 7 (plan 2026-07-17-002): the Cal.com booking webhook — R13-R16.
 *
 * Per the plan's testing fallback (the repo has no server-DB mock harness),
 * coverage is in three layers:
 *
 * 1. PURE decisions in `app/lib/calcom/events.ts` (parse + email extraction,
 *    `deriveEventKey`, `isFresh`, `cancelUidMatches`, `decideConsentUpgrade`,
 *    `sixMonthsAfter`) — exhaustively tested; this is where every branch's
 *    logic actually lives.
 * 2. The db-taking core (`stampCallBookedFromWebhook` / `runCalcomWebhook`) over
 *    a light in-memory fake db — branch effects, idempotency, ordering, R15.
 * 3. The HTTP route (`POST`) over a mocked `supabaseAdmin` — the trust boundary
 *    (401 on bad signature, no DB write), ping ack, and one happy path.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookingConsentInput,
  cancelUidMatches,
  decideConsentUpgrade,
  deriveEventKey,
  extractBookerEmail,
  extractBookerName,
  isFresh,
  isKnownTrigger,
  parseCalcomEvent,
  sixMonthsAfter,
} from "@/app/lib/calcom/events";
import {
  runCalcomWebhook,
  stampCallBookedFromWebhook,
} from "@/app/crm/lib/lead-ingest";

/* =============================================================== pure layer */

describe("isKnownTrigger", () => {
  it("accepts the three booking lifecycle triggers", () => {
    expect(isKnownTrigger("BOOKING_CREATED")).toBe(true);
    expect(isKnownTrigger("BOOKING_CANCELLED")).toBe(true);
    expect(isKnownTrigger("BOOKING_RESCHEDULED")).toBe(true);
  });
  it("rejects PING / BOOKING_REQUESTED / anything else", () => {
    expect(isKnownTrigger("PING")).toBe(false);
    expect(isKnownTrigger("BOOKING_REQUESTED")).toBe(false);
    expect(isKnownTrigger("")).toBe(false);
  });
});

describe("extractBookerEmail (canonical → attendee, never organizer)", () => {
  const payload = (o: Record<string, unknown>) => o;

  it("prefers responses.email.value", () => {
    expect(
      extractBookerEmail(
        payload({
          responses: { email: { value: "booker@example.com" } },
          attendees: [{ email: "attendee@example.com" }],
          organizer: { email: "host@example.com" },
        })
      )
    ).toBe("booker@example.com");
  });

  it("falls back to attendees[0].email when responses is absent", () => {
    expect(
      extractBookerEmail(
        payload({ attendees: [{ email: "attendee@example.com" }] })
      )
    ).toBe("attendee@example.com");
  });

  it("never uses organizer.email (the host)", () => {
    expect(extractBookerEmail(payload({ organizer: { email: "host@example.com" } }))).toBeNull();
  });

  it("returns null for a malformed address (validated, not trusted)", () => {
    expect(
      extractBookerEmail(payload({ responses: { email: { value: "not-an-email" } } }))
    ).toBeNull();
  });
});

describe("extractBookerName (length-capped)", () => {
  it("reads responses.name.value, trimmed", () => {
    expect(
      extractBookerName({ responses: { name: { value: "  Dana Osei  " } } })
    ).toBe("Dana Osei");
  });
  it("caps at 200 chars (flows into parent_name)", () => {
    const long = "x".repeat(500);
    expect(extractBookerName({ responses: { name: { value: long } } })).toHaveLength(200);
  });
  it("returns null when blank/absent", () => {
    expect(extractBookerName({})).toBeNull();
    expect(extractBookerName({ responses: { name: { value: "   " } } })).toBeNull();
  });
});

describe("parseCalcomEvent", () => {
  const base = {
    triggerEvent: "BOOKING_CREATED",
    createdAt: "2026-07-17T15:00:00Z",
    payload: {
      uid: "bk_1",
      startTime: "2026-07-20T18:00:00Z",
      responses: { email: { value: "booker@example.com" }, name: { value: "Dana" } },
    },
  };

  it("normalizes a valid known-trigger event", () => {
    const res = parseCalcomEvent(base);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-07-17T15:00:00.000Z",
      uid: "bk_1",
      startTime: "2026-07-20T18:00:00.000Z",
      rescheduleUid: null,
      email: "booker@example.com",
      bookerName: "Dana",
    });
  });

  it("acks (200) a ping / unknown trigger without failing", () => {
    const res = parseCalcomEvent({ triggerEvent: "PING", payload: {} });
    expect(res).toEqual({ ok: false, status: 200, reason: "unknown-trigger" });
  });

  it("acks (200) a body with no readable triggerEvent", () => {
    expect(parseCalcomEvent({ foo: "bar" })).toMatchObject({ ok: false, status: 200 });
  });

  it("400s a known trigger missing uid/createdAt (unusable payload)", () => {
    const res = parseCalcomEvent({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-07-17T15:00:00Z",
      payload: { startTime: "2026-07-20T18:00:00Z" },
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("captures rescheduleUid on a reschedule", () => {
    const res = parseCalcomEvent({
      triggerEvent: "BOOKING_RESCHEDULED",
      createdAt: "2026-07-18T15:00:00Z",
      payload: { uid: "bk_2", rescheduleUid: "bk_1", startTime: "2026-07-21T18:00:00Z" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.event.rescheduleUid).toBe("bk_1");
  });
});

describe("deriveEventKey", () => {
  it("is a stable sha256 hex of trigger:uid:createdAt", () => {
    const k = deriveEventKey("BOOKING_CREATED", "bk_1", "2026-07-17T15:00:00.000Z");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveEventKey("BOOKING_CREATED", "bk_1", "2026-07-17T15:00:00.000Z")).toBe(k);
  });
  it("differs when any component differs (a reschedule mints a new uid)", () => {
    const a = deriveEventKey("BOOKING_CREATED", "bk_1", "2026-07-17T15:00:00.000Z");
    const b = deriveEventKey("BOOKING_RESCHEDULED", "bk_2", "2026-07-17T15:00:00.000Z");
    expect(a).not.toBe(b);
  });
});

describe("isFresh (out-of-order guard; NULL = proceed)", () => {
  it("proceeds when there is no prior webhook stamp (null stored)", () => {
    expect(isFresh("2026-07-17T15:00:00Z", null)).toBe(true);
  });
  it("accepts a newer-or-equal event", () => {
    expect(isFresh("2026-07-18T00:00:00Z", "2026-07-17T00:00:00Z")).toBe(true);
    expect(isFresh("2026-07-17T00:00:00Z", "2026-07-17T00:00:00Z")).toBe(true);
  });
  it("rejects an older event", () => {
    expect(isFresh("2026-07-16T00:00:00Z", "2026-07-17T00:00:00Z")).toBe(false);
  });
  it("fails closed on an unparseable timestamp", () => {
    expect(isFresh("nope", "2026-07-17T00:00:00Z")).toBe(false);
  });
});

describe("cancelUidMatches (R15 authority)", () => {
  it("matches only an identical stored uid", () => {
    expect(cancelUidMatches("bk_1", "bk_1")).toBe(true);
    expect(cancelUidMatches("bk_1", "bk_2")).toBe(false);
  });
  it("never matches a null (manual) stamp — so a manual stamp is never wiped", () => {
    expect(cancelUidMatches(null, "bk_1")).toBe(false);
  });
});

describe("sixMonthsAfter / bookingConsentInput (CASL implied-EBR)", () => {
  it("adds 6 months to the inquiry date", () => {
    expect(sixMonthsAfter("2026-07-17T15:00:00.000Z")).toBe("2027-01-17T15:00:00.000Z");
  });
  it("builds the implied-EBR consent from the booking time", () => {
    expect(bookingConsentInput("2026-07-17T15:00:00.000Z")).toEqual({
      given: true,
      at: "2026-07-17T15:00:00.000Z",
      source: "booking-inquiry",
      expiresAt: "2027-01-17T15:00:00.000Z",
    });
  });
});

describe("decideConsentUpgrade (matched-lead booking consent)", () => {
  it("upgrades a no-consent, non-revoked family to implied-EBR", () => {
    expect(
      decideConsentUpgrade(
        { consent_given: false, consent_revoked_at: null },
        "2026-07-17T15:00:00.000Z"
      )
    ).toEqual({
      consent_given: true,
      consent_source: "booking-inquiry",
      consent_at: "2026-07-17T15:00:00.000Z",
      consent_expires_at: "2027-01-17T15:00:00.000Z",
    });
  });
  it("never downgrades an express-consent family", () => {
    expect(
      decideConsentUpgrade(
        { consent_given: true, consent_revoked_at: null },
        "2026-07-17T15:00:00.000Z"
      )
    ).toBeNull();
  });
  it("never re-subscribes a revoked family", () => {
    expect(
      decideConsentUpgrade(
        { consent_given: false, consent_revoked_at: "2026-07-08T00:00:00Z" },
        "2026-07-17T15:00:00.000Z"
      )
    ).toBeNull();
  });
});

/* ========================================================== fake db harness */

type Row = Record<string, unknown>;

interface FakeError {
  code?: string;
  message?: string;
}

class WebhookFakeDb {
  tables: Record<string, Row[]> = {
    families: [],
    parents: [],
    family_stage_history: [],
    processed_webhook_events: [],
  };
  private seq = 1;
  /** When > 0, the next families UPDATE rejects (simulate a transient DB blip). */
  throwOnFamiliesUpdate = 0;

  newId(): string {
    return `fam-${this.seq++}`;
  }
  table(name: string): Row[] {
    if (!this.tables[name]) throw new Error(`FakeDb: unknown table ${name}`);
    return this.tables[name];
  }
  from(name: string): FakeQuery {
    return new FakeQuery(this, name);
  }
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row | null = null;

  constructor(private db: WebhookFakeDb, private tableName: string) {}

  select(): this {
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row): this {
    this.op = "update";
    this.payload = row;
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  ilike(col: string, pattern: string): this {
    const needle = pattern.toLowerCase();
    this.filters.push((r) => String(r[col] ?? "").toLowerCase() === needle);
    return this;
  }
  limit(): this {
    return this;
  }

  private rows(): Row[] {
    return this.db.table(this.tableName).filter((r) => this.filters.every((f) => f(r)));
  }

  private runInsert(): { data: Row | null; error: FakeError | null } {
    const row: Row = { ...(this.payload ?? {}) };
    if (this.tableName === "families") {
      const email = row.email;
      if (email != null) {
        const clash = this.db.tables.families.some(
          (f) =>
            (f.merged_into_id ?? null) === null &&
            String(f.email ?? "").toLowerCase() === String(email).toLowerCase()
        );
        if (clash) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value" },
          };
        }
      }
      row.id = row.id ?? this.db.newId();
      row.merged_into_id = row.merged_into_id ?? null;
      row.engagement_signals = row.engagement_signals ?? [];
    }
    if (this.tableName === "processed_webhook_events") {
      const key = row.event_key;
      if (this.db.tables.processed_webhook_events.some((r) => r.event_key === key)) {
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }
    }
    this.db.table(this.tableName).push(row);
    return { data: { id: row.id }, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: FakeError | null }> {
    return { data: this.rows()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: FakeError | null }> {
    if (this.op === "insert") return this.runInsert();
    const row = this.rows()[0] ?? null;
    return { data: row, error: row ? null : { code: "PGRST116", message: "no rows" } };
  }

  then<T>(
    resolve: (v: { data: Row | null; error: FakeError | null }) => T,
    reject?: (e: unknown) => T
  ): Promise<T> {
    if (this.op === "update") {
      if (this.tableName === "families" && this.db.throwOnFamiliesUpdate > 0) {
        this.db.throwOnFamiliesUpdate -= 1;
        return Promise.reject(new Error("transient db failure")).then(
          resolve,
          reject
        );
      }
      for (const r of this.rows()) Object.assign(r, this.payload);
      return Promise.resolve(resolve({ data: null, error: null }));
    }
    if (this.op === "insert") {
      const { error } = this.runInsert();
      return Promise.resolve(resolve({ data: null, error }));
    }
    return Promise.resolve(resolve({ data: this.rows()[0] ?? null, error: null }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: WebhookFakeDb): any => db;

const CREATED = (o: Partial<Record<string, unknown>> = {}) => ({
  triggerEvent: "BOOKING_CREATED" as const,
  createdAt: "2026-07-17T15:00:00.000Z",
  uid: "bk_1",
  startTime: "2026-07-20T18:00:00.000Z",
  rescheduleUid: null,
  email: "booker@example.com",
  bookerName: "Dana Osei",
  ...o,
});

const liveFamily = (o: Partial<Row> = {}): Row => ({
  id: "fam-existing",
  email: "booker@example.com",
  merged_into_id: null,
  engagement_signals: [],
  consent_given: false,
  consent_at: null,
  consent_source: null,
  consent_revoked_at: null,
  consent_expires_at: null,
  call_booked_at: null,
  call_booked_uid: null,
  call_booked_event_at: null,
  ...o,
});

/* ============================================== core: stampCallBookedFromWebhook */

describe("BOOKING_CREATED", () => {
  it("unknown email → creates a booking lead with implied-EBR consent, then stamps it", async () => {
    const db = new WebhookFakeDb();
    const res = await stampCallBookedFromWebhook(asDb(db), CREATED());

    expect(res).toMatchObject({ kind: "stamped", matched: false });
    expect(db.tables.families).toHaveLength(1);
    const fam = db.tables.families[0];
    expect(fam).toMatchObject({
      source: "booking",
      email: "booker@example.com",
      parent_name: "Dana Osei",
      consent_given: true,
      consent_source: "booking-inquiry",
      consent_at: "2026-07-17T15:00:00.000Z",
      consent_expires_at: "2027-01-17T15:00:00.000Z",
      call_booked_at: "2026-07-20T18:00:00.000Z",
      call_booked_uid: "bk_1",
      call_booked_event_at: "2026-07-17T15:00:00.000Z",
    });
    // family_stage_history row with a NULL actor (external ingest).
    expect(db.tables.family_stage_history).toHaveLength(1);
    expect(db.tables.family_stage_history[0]).toMatchObject({
      family_id: fam.id,
      to_stage: "call_booked",
      actor: null,
      note: "stamp · 2026-07-20T18:00:00.000Z",
    });
  });

  it("no bookerName → synthesizes 'Booking: {email}' (never an unnamed lead)", async () => {
    const db = new WebhookFakeDb();
    await stampCallBookedFromWebhook(asDb(db), CREATED({ bookerName: null }));
    expect(db.tables.families[0].parent_name).toBe("Booking: booker@example.com");
  });

  it("matched email → stamps the existing family, no duplicate row", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ consent_given: true, consent_source: "info-session", consent_at: "2026-07-01T00:00:00Z" })
    );
    const res = await stampCallBookedFromWebhook(asDb(db), CREATED());

    expect(res).toMatchObject({ kind: "stamped", matched: true, familyId: "fam-existing" });
    expect(db.tables.families).toHaveLength(1);
    expect(db.tables.families[0]).toMatchObject({
      call_booked_uid: "bk_1",
      call_booked_event_at: "2026-07-17T15:00:00.000Z",
      call_booked_at: "2026-07-20T18:00:00.000Z",
    });
  });

  it("consent (matched): a no-consent, non-revoked family is upgraded to implied-EBR", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(liveFamily({ consent_given: false, consent_revoked_at: null }));
    await stampCallBookedFromWebhook(asDb(db), CREATED());

    expect(db.tables.families[0]).toMatchObject({
      consent_given: true,
      consent_source: "booking-inquiry",
      consent_at: "2026-07-17T15:00:00.000Z",
      consent_expires_at: "2027-01-17T15:00:00.000Z",
      call_booked_uid: "bk_1",
    });
  });

  it("consent (matched): an express-consent family is NOT downgraded", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ consent_given: true, consent_source: "signup", consent_at: "2026-01-01T00:00:00Z", consent_expires_at: null })
    );
    await stampCallBookedFromWebhook(asDb(db), CREATED());

    const fam = db.tables.families[0];
    expect(fam.consent_source).toBe("signup");
    expect(fam.consent_expires_at).toBeNull(); // express consent keeps no expiry
    expect(fam.call_booked_uid).toBe("bk_1"); // still stamped
  });

  it("consent (matched): a revoked family is NOT re-subscribed (but is still stamped)", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ consent_given: true, consent_revoked_at: "2026-07-08T00:00:00Z" })
    );
    await stampCallBookedFromWebhook(asDb(db), CREATED());

    const fam = db.tables.families[0];
    expect(fam.consent_revoked_at).toBe("2026-07-08T00:00:00Z");
    expect(fam.call_booked_uid).toBe("bk_1");
  });

  it("no booker email → no-op (cannot match or create)", async () => {
    const db = new WebhookFakeDb();
    const res = await stampCallBookedFromWebhook(asDb(db), CREATED({ email: null }));
    expect(res).toMatchObject({ kind: "noop" });
    expect(db.tables.families).toHaveLength(0);
  });
});

describe("BOOKING_RESCHEDULED", () => {
  it("finds by rescheduleUid, swaps in the new uid, updates the time", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({
        call_booked_at: "2026-07-20T18:00:00.000Z",
        call_booked_uid: "bk_1",
        call_booked_event_at: "2026-07-17T15:00:00.000Z",
      })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({
        triggerEvent: "BOOKING_RESCHEDULED",
        uid: "bk_2",
        rescheduleUid: "bk_1",
        createdAt: "2026-07-18T09:00:00.000Z",
        startTime: "2026-07-22T18:00:00.000Z",
      })
    );

    expect(res).toMatchObject({ kind: "rescheduled" });
    expect(db.tables.families[0]).toMatchObject({
      call_booked_uid: "bk_2",
      call_booked_at: "2026-07-22T18:00:00.000Z",
      call_booked_event_at: "2026-07-18T09:00:00.000Z",
    });
  });

  it("falls back to booker email when no family carries the reschedule uid", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ call_booked_uid: "bk_1", call_booked_event_at: "2026-07-17T15:00:00.000Z" })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({
        triggerEvent: "BOOKING_RESCHEDULED",
        uid: "bk_2",
        rescheduleUid: "bk_UNKNOWN",
        createdAt: "2026-07-18T09:00:00.000Z",
        startTime: "2026-07-22T18:00:00.000Z",
      })
    );
    expect(res).toMatchObject({ kind: "rescheduled" });
    expect(db.tables.families[0].call_booked_uid).toBe("bk_2");
  });
});

describe("BOOKING_CANCELLED (R15 + ordering)", () => {
  it("clears the stamp when the uid matches and the event is fresh", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({
        call_booked_at: "2026-07-20T18:00:00.000Z",
        call_booked_uid: "bk_1",
        call_booked_event_at: "2026-07-17T15:00:00.000Z",
      })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({ triggerEvent: "BOOKING_CANCELLED", uid: "bk_1", createdAt: "2026-07-18T09:00:00.000Z" })
    );

    expect(res).toMatchObject({ kind: "cleared" });
    expect(db.tables.families[0]).toMatchObject({
      call_booked_at: null,
      call_booked_uid: null,
      call_booked_event_at: null,
    });
  });

  it("R15: a cancel whose uid ≠ stored uid does NOT clear", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ call_booked_at: "2026-07-20T18:00:00.000Z", call_booked_uid: "bk_1", call_booked_event_at: "2026-07-17T15:00:00.000Z" })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({ triggerEvent: "BOOKING_CANCELLED", uid: "bk_OTHER", createdAt: "2026-07-18T09:00:00.000Z" })
    );
    expect(res).toMatchObject({ kind: "noop" });
    expect(db.tables.families[0].call_booked_uid).toBe("bk_1");
  });

  it("R15: a manual stamp (null uid) is NEVER wiped by a cancel", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ call_booked_at: "2026-07-20T18:00:00.000Z", call_booked_uid: null, call_booked_event_at: null })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({ triggerEvent: "BOOKING_CANCELLED", uid: "bk_1", createdAt: "2026-07-18T09:00:00.000Z" })
    );
    expect(res).toMatchObject({ kind: "noop" });
    expect(db.tables.families[0].call_booked_at).toBe("2026-07-20T18:00:00.000Z");
  });

  it("ordering: a stale cancel (older createdAt) after a newer stamp is ignored", async () => {
    const db = new WebhookFakeDb();
    db.tables.families.push(
      liveFamily({ call_booked_at: "2026-07-20T18:00:00.000Z", call_booked_uid: "bk_1", call_booked_event_at: "2026-07-18T00:00:00.000Z" })
    );
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({ triggerEvent: "BOOKING_CANCELLED", uid: "bk_1", createdAt: "2026-07-17T00:00:00.000Z" })
    );
    expect(res).toMatchObject({ kind: "noop" });
    expect(db.tables.families[0].call_booked_uid).toBe("bk_1"); // stamp stands
  });

  it("cancel for an unknown email → 200-worthy no-op", async () => {
    const db = new WebhookFakeDb();
    const res = await stampCallBookedFromWebhook(
      asDb(db),
      CREATED({ triggerEvent: "BOOKING_CANCELLED", email: "nobody@example.com", uid: "bk_1" })
    );
    expect(res).toMatchObject({ kind: "noop" });
  });
});

/* ============================================== orchestration: runCalcomWebhook */

describe("runCalcomWebhook (idempotency + durability)", () => {
  it("same event delivered twice → second is a deduped no-op, no double effect", async () => {
    const db = new WebhookFakeDb();
    const event = CREATED();

    const first = await runCalcomWebhook(asDb(db), event);
    const second = await runCalcomWebhook(asDb(db), event);

    expect(first.status).toBe("applied");
    expect(second).toEqual({ status: "deduped" });
    expect(db.tables.families).toHaveLength(1);
    expect(db.tables.family_stage_history).toHaveLength(1); // stamped once
    expect(db.tables.processed_webhook_events).toHaveLength(1); // recorded once
  });

  it("a transient failure between accept and effect does NOT permanently drop the stamp", async () => {
    const db = new WebhookFakeDb();
    const event = CREATED();
    db.throwOnFamiliesUpdate = 1; // the stamp UPDATE fails on the first delivery

    // First delivery: the lead is inserted, but the stamp UPDATE throws → the
    // route would 500 and NOT record the dedupe key.
    await expect(runCalcomWebhook(asDb(db), event)).rejects.toThrow();
    expect(db.tables.processed_webhook_events).toHaveLength(0);
    expect(db.tables.families[0].call_booked_uid).toBeUndefined();

    // Cal.com retries: dedupe is empty, matchOrCreateLead finds the same lead
    // (no duplicate), the stamp applies, and the key is now recorded.
    const retry = await runCalcomWebhook(asDb(db), event);
    expect(retry.status).toBe("applied");
    expect(db.tables.families).toHaveLength(1);
    expect(db.tables.families[0].call_booked_uid).toBe("bk_1");
    expect(db.tables.processed_webhook_events).toHaveLength(1);
  });
});

/* ================================================ HTTP route (trust boundary) */

const SECRET = "whsec_route_test";
const sign = (body: string): string =>
  createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as WebhookFakeDb | null } }));
vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => dbRef.current,
}));

const post = (body: string, sig: string | null): Promise<Response> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sig !== null) headers["x-cal-signature-256"] = sig;
  const req = new Request("http://localhost/api/webhooks/calcom", {
    method: "POST",
    headers,
    body,
  });
  // Imported lazily so the vi.mock + env are in place first.
  return import("@/app/api/webhooks/calcom/route").then((m) => m.POST(req));
};

describe("POST /api/webhooks/calcom (route glue)", () => {
  beforeEach(() => {
    dbRef.current = new WebhookFakeDb();
    process.env.CAL_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CAL_WEBHOOK_SECRET;
  });

  it("401s a wrong signature and writes nothing", async () => {
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-07-17T15:00:00Z", payload: { uid: "bk_1" } });
    const res = await post(body, "deadbeef");
    expect(res.status).toBe(401);
    expect(dbRef.current!.tables.families).toHaveLength(0);
  });

  it("401s a missing signature", async () => {
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-07-17T15:00:00Z", payload: { uid: "bk_1" } });
    const res = await post(body, null);
    expect(res.status).toBe(401);
  });

  it("acks a ping (200) with no CRM write", async () => {
    const body = JSON.stringify({ triggerEvent: "PING", payload: {} });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(dbRef.current!.tables.families).toHaveLength(0);
    expect(dbRef.current!.tables.processed_webhook_events).toHaveLength(0);
  });

  it("valid signature + BOOKING_CREATED (unknown email) → 200, creates + stamps the lead", async () => {
    const body = JSON.stringify({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-07-17T15:00:00Z",
      payload: {
        uid: "bk_1",
        startTime: "2026-07-20T18:00:00Z",
        responses: { email: { value: "booker@example.com" }, name: { value: "Dana" } },
      },
    });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(dbRef.current!.tables.families).toHaveLength(1);
    expect(dbRef.current!.tables.families[0]).toMatchObject({
      source: "booking",
      call_booked_uid: "bk_1",
    });
    expect(dbRef.current!.tables.processed_webhook_events).toHaveLength(1);
  });
});
