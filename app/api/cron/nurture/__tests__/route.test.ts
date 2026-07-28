import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { offerStepFor } from "@/app/lib/nurture/rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const routeSrc = () =>
  readFileSync(path.resolve(REPO_ROOT, "app/api/cron/nurture/route.ts"), "utf8");

/* ─────────────────── a fake PostgREST the route can drive ─────────────────── */

type Row = Record<string, unknown>;

class FakeDb {
  tables: Record<string, Row[]> = {
    families: [],
    children: [],
    deposits: [],
    nurture_sends: [],
    child_reviews: [],
  };
  /** Every select the route issued, by table → the column list it asked for. */
  selects: Record<string, string> = {};
  inserts: { table: string; row: Row }[] = [];
  deletes: { table: string; match: Row }[] = [];
  updates: { table: string; patch: Row }[] = [];

  from = (table: string) => {
    const result = (data: Row[]) => ({ data, error: null });
    return {
      select: (cols: string) => {
        this.selects[table] = cols;
        const rows = this.tables[table] ?? [];
        // The route only chains filters that narrow rows the fakes already
        // model correctly (merged_into_id null; offer stamp not null).
        return Object.assign(Promise.resolve(result(rows)), {
          is: () => Promise.resolve(result(rows.filter((r) => r.merged_into_id === null))),
          not: () => Promise.resolve(result(rows.filter((r) => r.offer_email_sent_at !== null))),
        });
      },
      insert: (row: Row) => {
        // The unique (family_id, sequence, step) claim.
        const dupe = (this.tables[table] ?? []).some(
          (r) => r.family_id === row.family_id && r.sequence === row.sequence && r.step === row.step
        );
        if (dupe) return Promise.resolve({ error: { message: "duplicate key" } });
        this.inserts.push({ table, row });
        this.tables[table] = [...(this.tables[table] ?? []), row];
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        match: (m: Row) => {
          this.deletes.push({ table, match: m });
          return Promise.resolve({ error: null });
        },
      }),
      update: (patch: Row) => ({
        eq: () => {
          this.updates.push({ table, patch });
          return Promise.resolve({ error: null });
        },
      }),
    };
  };
}

const { dbRef, sendRef } = vi.hoisted(() => ({
  dbRef: { current: null as FakeDb | null },
  sendRef: { current: [] as { familyId: string; email: string }[], ok: true },
}));

vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => dbRef.current }));
vi.mock("@/app/lib/nurture/send", () => ({
  sendNurtureEmail: async (familyId: string, email: string) => {
    sendRef.current.push({ familyId, email });
    return sendRef.ok ? { ok: true } : { ok: false, error: "smtp down" };
  },
}));

const SECRET = "cron_secret_test";
const get = (auth: string | null = `Bearer ${SECRET}`) => {
  const headers: Record<string, string> = {};
  if (auth !== null) headers.authorization = auth;
  const req = new Request("http://localhost/api/cron/nurture", { method: "GET", headers });
  return import("@/app/api/cron/nurture/route").then((m) => m.GET(req));
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/** A family whose child was offered 3.5 days ago: the nudge is due. */
function seedOfferDue(db: FakeDb, childId: string, extra: Partial<Row> = {}) {
  db.tables.families = [
    {
      id: "fam-1",
      email: "parent@example.com",
      parent_id: "par-1",
      parent_name: "Dana Verne",
      consent_given: true,
      consent_revoked_at: null,
      merged_into_id: null,
      signup_at: null,
      dossier_submitted_at: null,
      deposit_asked_referral: false,
      consent_expires_at: null,
    },
  ];
  db.tables.children = [
    {
      id: childId,
      parent_id: "par-1",
      first_name: "Ada",
      last_name: "Verne",
      grade: 5,
      birth_year: "2016",
      current_school: "Maple PS",
      group_slug: "scholars",
      applicant_state: "offered",
      academics: [],
      subjects: [],
      workshop_ids: [],
      interests: "",
      project_pitch: "",
      status: "offered",
      updated_at: daysAgo(4),
      ...extra,
    },
  ];
  db.tables.child_reviews = [{ child_id: childId, offer_email_sent_at: daysAgo(3.5) }];
}

describe("GET /api/cron/nurture — the route's own wiring, driven end to end", () => {
  beforeEach(() => {
    dbRef.current = new FakeDb();
    sendRef.current = [];
    sendRef.ok = true;
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.resetModules();
  });

  it("503s when unconfigured and 401s on a bad secret — nothing sends either way", async () => {
    delete process.env.CRON_SECRET;
    expect((await get()).status).toBe(503);
    process.env.CRON_SECRET = SECRET;
    expect((await get("Bearer wrong")).status).toBe(401);
    expect((await get(null)).status).toBe(401);
    expect(sendRef.current).toEqual([]);
  });

  it("W8: the offer stamp is joined to the RIGHT child by id, and the claim carries the per-child step", async () => {
    // The id-matching this test exists for: child_reviews.child_id must
    // line up with children.id, or every offer_email_sent_at is silently
    // dropped and no nudge ever sends.
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    const res = await get();
    expect(res.status).toBe(200);
    const claim = db.inserts.find((i) => i.table === "nurture_sends");
    expect(claim, "no nurture_sends claim was written").toBeTruthy();
    expect(claim!.row).toMatchObject({
      family_id: "fam-1",
      sequence: "offer",
      step: offerStepFor("kid-abc"),
    });
    expect(sendRef.current).toHaveLength(1);
  });

  it("W8: the deposits select really carries child_id at runtime, so the per-child gate can read it", async () => {
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    await get();
    expect(db.selects.deposits.split(",")).toContain("child_id");
    expect(db.selects.children.split(",")).toContain("id");
  });

  it("W8: that child's own paid deposit silences the nudge; a sibling's does not", async () => {
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    db.tables.deposits = [
      { parent_id: "par-1", child_id: "kid-abc", status: "paid", refunded_at: null, created_at: daysAgo(1) },
    ];
    await get();
    expect(db.inserts.filter((i) => i.row.sequence === "offer")).toEqual([]);

    // Now the same deposit belongs to a SIBLING — the nudge must survive.
    dbRef.current = new FakeDb();
    sendRef.current = [];
    const db2 = dbRef.current!;
    seedOfferDue(db2, "kid-abc");
    db2.tables.deposits = [
      { parent_id: "par-1", child_id: "kid-sibling", status: "paid", refunded_at: null, created_at: daysAgo(400) },
    ];
    await get();
    expect(db2.inserts.some((i) => i.row.step === offerStepFor("kid-abc"))).toBe(true);
  });

  it("claim-then-send: a successful send KEEPS its claim (no release), so it never repeats", async () => {
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    await get();
    expect(sendRef.current).toHaveLength(1);
    // The structural fact a source pin cannot see: delete is in the else.
    expect(db.deletes).toEqual([]);
  });

  it("claim-then-send: a FAILED send releases exactly its own claim, so tomorrow retries", async () => {
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    sendRef.ok = false;
    await get();
    expect(db.deletes).toHaveLength(1);
    expect(db.deletes[0]).toMatchObject({
      table: "nurture_sends",
      match: { family_id: "fam-1", sequence: "offer", step: offerStepFor("kid-abc") },
    });
  });

  it("an already-claimed slot is skipped without sending (the unique constraint IS the dedupe)", async () => {
    const db = dbRef.current!;
    seedOfferDue(db, "kid-abc");
    db.tables.nurture_sends = [
      { family_id: "fam-1", sequence: "offer", step: offerStepFor("kid-abc"), email: "parent@example.com" },
    ];
    await get();
    expect(sendRef.current).toEqual([]);
  });
});

describe("the nurture cron's source contract", () => {
  it("exports GET — Vercel cron sends GET, and a POST-only export 405s every run forever", () => {
    const src = routeSrc();
    expect(src).toMatch(/export async function GET\b/);
    expect(src).not.toMatch(/export async function POST\b/);
  });

  it("requires the cron secret", () => {
    expect(routeSrc()).toContain("CRON_SECRET");
  });
});
