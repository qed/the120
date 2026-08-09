import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  FP_CONSENT_POLICY,
  currentPolicyHash,
  photoConsentVerdict,
} from "@/app/api/fp/signup/consent-rules";
import type { CreateChildInput, CreateChildResult } from "@/app/api/fp/signup/child-core";
import { blobKey } from "@/app/lib/fp/cover-store-rules";
import {
  loadV3OnboardingState,
  v3AddKid,
  v3ProvisionKid,
  v3SaveStory,
  V3_MAX_ACTIVE_DRAFTS_PER_PARENT,
  type V3OnboardingDeps,
  type V3ParentContext,
} from "../v3-onboarding-core";

/**
 * The v3 onboarding core (plan Unit 3) driven by EXECUTION against the stateful
 * fake-supabase harness — the same shape as
 * app/api/fp/signup/__tests__/{child-core,consent-core,signup-core}.test.ts.
 *
 * This file exists because review FIX 3 found the unit's most sequencing-
 * sensitive invariants asserted only in prose: the attempt → consent → draft
 * write ORDER and what each half-finished prefix leaves behind; the guards that
 * must refuse BEFORE anything is minted; the idempotent-replay path's re-read of
 * `fp_username`; and the two "decoration never fails provisioning" degradations.
 * Every one of those is a claim about a SEQUENCE, which only an executing test
 * over shared state can hold.
 *
 * `recordConsent` is the REAL one (it writes through the same fake store), so
 * the consent record this core mints is the record `consentGate` would later
 * claim. Only `createChild` is injected — this module owns sequencing, not child
 * creation.
 */

/* --------------------------------------------------------------- harness */

const PARENT_ID = "parent-1";
/** A pre-existing child id used by the replay tests. A UUID because
 *  `planCoverCarry` refuses an owner id it could not build a safe blob key from. */
const CHILD_EXISTING = randomUUID();
const PARENT_EMAIL = "alex@example.com";

const ctx: V3ParentContext = {
  parentId: PARENT_ID,
  parentEmail: PARENT_EMAIL,
  parentToken: "parent-access-token",
  ip: "203.0.113.7",
  ua: "vitest",
};

/** Every builder call, in the order the CODE made it — the only way to assert a
 *  write ORDER (the store alone cannot tell you which insert happened first). */
type CallLog = string[];

function recordingClient(store: Store, log: CallLog, faults?: FaultPlan) {
  const base = fakeClient(store, faults);
  return {
    ...base,
    from(table: string) {
      const builder = base.from(table) as unknown as Record<string, unknown>;
      for (const op of ["insert", "update", "delete", "upsert"] as const) {
        const original = builder[op] as (...args: unknown[]) => unknown;
        builder[op] = (...args: unknown[]) => {
          log.push(`${op}:${table}`);
          return original.apply(builder, args);
        };
      }
      return builder;
    },
  } as unknown as V3OnboardingDeps["db"];
}

type HarnessCfg = {
  faults?: FaultPlan;
  /** The injected `createChild`. Defaults to a fresh, successful mint. */
  createChild?: (input: CreateChildInput) => Promise<CreateChildResult>;
  copyCoverBlob?: (input: { from: string; to: string }) => Promise<{ ok: boolean }>;
  /** The `[0,1)` stream the per-kid password fallback draws from. */
  random?: () => number;
};

function harness(cfg: HarnessCfg = {}) {
  const store = newStore();
  store.fp_onboarding_drafts = [];
  const log: CallLog = [];
  const createChildCalls: CreateChildInput[] = [];
  const mintedChildIds = [randomUUID(), randomUUID(), randomUUID()];
  const deps: V3OnboardingDeps = {
    db: recordingClient(store, log, cfg.faults),
    createChild: async (input) => {
      createChildCalls.push(input);
      if (cfg.createChild) return cfg.createChild(input);
      // A UUID, not a readable label: `planCoverCarry` builds a Blob key from
      // the child id and REFUSES an unsafe one, so a fake id that real
      // provisioning could never produce would fail for the wrong reason.
      const childId = mintedChildIds[createChildCalls.length - 1];
      store.children.push({
        id: childId,
        parent_id: PARENT_ID,
        first_name: input.firstName,
        last_name: input.lastName ?? "",
        fp_username: "remi.newal",
      });
      return { ok: true, childId, playerProfileId: "pp1", username: "remi.newal" };
    },
    copyCoverBlob: cfg.copyCoverBlob,
    now: () => 1_700_000_000_000,
    random: cfg.random ?? (() => 0),
    env: {},
  };
  return { store, log, deps, createChildCalls, mintedChildIds };
}

const goodEcho = {
  consentVersion: FP_CONSENT_POLICY.version,
  consentHash: currentPolicyHash(),
};

const addKidBody = (over: Record<string, unknown> = {}) => ({
  fullName: "Remi Newal",
  age: "9",
  ...goodEcho,
  ...over,
});

const inserts = (log: CallLog) => log.filter((l) => l.startsWith("insert:"));

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------- v3AddKid: the order */

describe("v3AddKid — the write order is attempt, then consent, then draft", () => {
  it("mints all three, in that order, and the draft carries the attempt", async () => {
    const { store, log, deps } = harness();
    const res = await v3AddKid(deps, addKidBody(), ctx);
    expect(res).toMatchObject({ kind: "added" });

    // The order is load-bearing, not incidental: `recordConsent` needs the
    // attempt id, and the draft's signup_attempt_id FK wants the attempt to
    // exist. The reverse order is not available.
    expect(inserts(log)).toEqual([
      "insert:fp_signup_attempts",
      "insert:fp_parental_consent",
      "insert:fp_onboarding_drafts",
    ]);

    const attempt = store.fp_signup_attempts[0];
    // Born `verified` with the session's parent linked, carrying NO verification
    // secret at all — the stated invariant in the module header.
    expect(attempt).toMatchObject({
      parent_id: PARENT_ID,
      parent_email: PARENT_EMAIL,
      state: "verified",
      code_guess_count: 0,
    });
    expect(attempt.verification_code_hash).toBeUndefined();
    expect(attempt.code_expires_at).toBeUndefined();

    expect(store.fp_parental_consent[0]).toMatchObject({
      signup_attempt_id: attempt.id,
      parent_id: PARENT_ID,
      // The age the parent typed (9) lands in the under-13 band.
      child_age_band: "under_13",
      jurisdiction: "CA-ON",
    });

    expect(store.fp_onboarding_drafts).toHaveLength(1);
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      parent_id: PARENT_ID,
      signup_attempt_id: attempt.id,
      kid_first_name: "Remi",
      kid_last_name: "Newal",
      kid_age: 9,
      status: "active",
    });
  });

  it("a consent refusal leaves the attempt but NO draft (the documented half-sequence)", async () => {
    // recordConsent re-reads the attempt for freshness; fault that read so the
    // consent refuses AFTER the attempt is already inserted.
    const { store, deps } = harness({
      faults: { "select:fp_signup_attempts": { kind: "error", error: { message: "boom" } } },
    });
    const res = await v3AddKid(deps, addKidBody(), ctx);
    // An `outage` reason is OUR fault, so it surfaces as the generic failure.
    expect(res).toEqual({ kind: "failed" });
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(store.fp_parental_consent).toHaveLength(0);
    expect(store.fp_onboarding_drafts).toHaveLength(0);
  });
});

/* ------------------------------------------- v3AddKid: refuse before minting */

describe("v3AddKid — every guard refuses BEFORE anything is minted", () => {
  it("the duplicate guard short-circuits before any insert", async () => {
    const { store, log, deps } = harness();
    store.children.push({
      id: CHILD_EXISTING,
      parent_id: PARENT_ID,
      first_name: "Remi",
      last_name: "Newal",
    });

    const res = await v3AddKid(deps, addKidBody(), ctx);
    expect(res).toEqual({
      kind: "duplicate",
      kid: { id: CHILD_EXISTING, kind: "child", firstName: "Remi", lastName: "Newal" },
    });
    // Not one row anywhere: an attempt row for a kid we are about to refuse is
    // pure litter, and a consent record for a child that will never exist is
    // worse than litter.
    expect(inserts(log)).toEqual([]);
    expect(store.fp_signup_attempts).toHaveLength(0);
    expect(store.fp_parental_consent).toHaveLength(0);
    expect(store.fp_onboarding_drafts).toHaveLength(0);
  });

  it("a STALE consent echo refuses before minting anything", async () => {
    const { store, log, deps } = harness();
    const res = await v3AddKid(
      deps,
      addKidBody({ consentVersion: "1900-01-01" }),
      ctx
    );
    expect(res).toEqual({ kind: "consent_refused", reason: "stale_or_tampered_echo" });
    expect(inserts(log)).toEqual([]);
    expect(store.fp_signup_attempts).toHaveLength(0);
  });

  it("a TAMPERED hash echo refuses before minting anything", async () => {
    const { store, log, deps } = harness();
    const res = await v3AddKid(deps, addKidBody({ consentHash: "0".repeat(64) }), ctx);
    expect(res).toEqual({ kind: "consent_refused", reason: "stale_or_tampered_echo" });
    expect(inserts(log)).toEqual([]);
    expect(store.fp_parental_consent).toHaveLength(0);
  });

  it("an invalid age refuses before minting anything", async () => {
    const { log, deps } = harness();
    const res = await v3AddKid(deps, addKidBody({ age: "2" }), ctx);
    expect(res).toMatchObject({ kind: "invalid", field: "age" });
    expect(inserts(log)).toEqual([]);
  });
});

/* ------------------------- v3AddKid: the DB is the duplicate arbiter (FIX 2) */

describe("v3AddKid — the unique index is the duplicate arbiter under a race", () => {
  it("two CONCURRENT adds for the same parent+kid mint exactly ONE draft; the loser gets the duplicate/resume outcome", async () => {
    const { store, deps } = harness();

    // The bug this pins: both calls read an empty state, both pass
    // findDuplicateKid, and — without the partial unique index — each mints its
    // own attempt + consent + draft. Two drafts means two independent
    // v3ProvisionKid calls, and because consentGate binds per ATTEMPT and
    // createChild's idempotency key IS the attempt id, that means TWO children,
    // two auth accounts and two live logins for one kid.
    const [a, b] = await Promise.all([
      v3AddKid(deps, addKidBody(), ctx),
      v3AddKid(deps, addKidBody(), ctx),
    ]);

    // EXACTLY ONE DRAFT. This is the assertion the whole fix exists for.
    expect(store.fp_onboarding_drafts).toHaveLength(1);
    const winner = store.fp_onboarding_drafts[0];

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["added", "duplicate"]);

    const added = (a.kind === "added" ? a : b) as { kind: "added"; draftId: string };
    const dup = (a.kind === "duplicate" ? a : b) as {
      kind: "duplicate";
      kid: { id: string; kind: string };
    };
    expect(added.draftId).toBe(winner.id);
    // The loser is pointed at the row that actually exists — the winner's draft,
    // which is exactly what the "Resume Remi" affordance needs.
    expect(dup.kid).toMatchObject({ id: winner.id, kind: "draft", firstName: "Remi" });

    // Only ONE draft can ever reach provisioning, so only one child can be
    // minted, which is the property that matters.
    //
    // ── AND THE LOSER LEAVES NOTHING BEHIND (whole-branch review, finding 3) ──
    // This assertion used to be `toHaveLength(2)` on both tables, with a
    // judgment call written above it: the loser's attempt and consent were
    // "inert litter that reaps itself". They were not reaped by anything — no
    // sweep for either table existed — and the consent row in particular is
    // LEGAL EVIDENCE, minted alongside a live affirmation, attached to nothing.
    // The losing branch now compensates, in the order the FK demands (consent
    // first: `signup_attempt_id` is ON DELETE SET NULL, so removing the attempt
    // first would null the only link and leave the evidence unfindable).
    //
    // The original judgment call still stands where it was actually about
    // ordering: the DRAFT is still inserted LAST. Inserting it first would give
    // exactly-one of all three, but it trades that for a far worse failure — a
    // draft with no attempt is one v3ProvisionKid can NEVER mint from
    // (`!draft.attemptId` → `no_draft`), and the unique index would then keep
    // refusing the family's retries. Compensating beats reordering.
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(store.fp_parental_consent).toHaveLength(1);
    // And it is the WINNER's pair that survived — the loser compensated its own
    // rows and touched nothing else.
    expect(store.fp_signup_attempts[0].id).toBe(winner.signup_attempt_id);
    expect(store.fp_parental_consent[0].signup_attempt_id).toBe(winner.signup_attempt_id);
  });

  it("the GENERIC draft-insert failure compensates too — not only the 23505 branch", async () => {
    // The other losing branch. Both were leaking; a fix that only covered the
    // race would leave the rarer, quieter one intact.
    const { store, deps } = harness({
      faults: { "insert:fp_onboarding_drafts": { kind: "error", error: { message: "boom" } } },
    });

    expect(await v3AddKid(deps, addKidBody(), ctx)).toEqual({ kind: "failed" });

    expect(store.fp_onboarding_drafts).toHaveLength(0);
    expect(store.fp_signup_attempts).toHaveLength(0);
    expect(store.fp_parental_consent).toHaveLength(0);
  });

  it("a compensation that ITSELF fails is loud, and leaves the attempt as the handle for the backstop", async () => {
    // If the consent delete fails there is nothing to be done in-request. The
    // attempt is deliberately KEPT: it is the only handle the draft reaper's
    // orphan sweep (and an operator) has for finding that consent row again.
    const { store, deps } = harness({
      faults: {
        "insert:fp_onboarding_drafts": { kind: "error", error: { message: "boom" } },
        "delete:fp_parental_consent": { kind: "error", error: { message: "delete down" } },
      },
    });

    expect(await v3AddKid(deps, addKidBody(), ctx)).toEqual({ kind: "failed" });

    expect(store.fp_parental_consent).toHaveLength(1);
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(store.fp_signup_attempts[0].id).toBe(store.fp_parental_consent[0].signup_attempt_id);
    expect(errors.some((e) => e.includes("STRANDED CONSENT"))).toBe(true);
  });

  it("`differentChild: true` does NOT get past the index — the DB refuses what the pre-check was told to skip", async () => {
    const { store, deps } = harness();
    expect(await v3AddKid(deps, addKidBody(), ctx)).toMatchObject({ kind: "added" });

    // The override only silences the app-level pre-check. The index still holds.
    const second = await v3AddKid(deps, addKidBody({ differentChild: true }), ctx);
    expect(second).toMatchObject({ kind: "duplicate" });
    expect(store.fp_onboarding_drafts).toHaveLength(1);
  });

  it("case differs, same kid: the index is keyed on lower(), so `REMI NEWAL` still resolves to the one draft", async () => {
    const { store, deps } = harness();
    await v3AddKid(deps, addKidBody(), ctx);
    const second = await v3AddKid(
      deps,
      addKidBody({ fullName: "REMI NEWAL", differentChild: true }),
      ctx
    );
    expect(second).toMatchObject({ kind: "duplicate" });
    expect(store.fp_onboarding_drafts).toHaveLength(1);
  });

  it("a genuinely DIFFERENT kid still gets their own live draft", async () => {
    const { store, deps } = harness();
    await v3AddKid(deps, addKidBody(), ctx);
    const second = await v3AddKid(
      deps,
      addKidBody({ fullName: "Sam Newal", age: "11", differentChild: true }),
      ctx
    );
    expect(second).toMatchObject({ kind: "added" });
    expect(store.fp_onboarding_drafts).toHaveLength(2);
  });
});

/* --------------------------------------- v3AddKid: the per-parent budget */

describe("v3AddKid — the per-parent live-draft budget (review FIX 7)", () => {
  it("refuses `capped` at the ceiling, and mints NOTHING when it does", async () => {
    const { store, log, deps } = harness();
    for (let i = 0; i < V3_MAX_ACTIVE_DRAFTS_PER_PARENT; i += 1) {
      store.fp_onboarding_drafts.push({
        id: `draft-${i}`,
        parent_id: PARENT_ID,
        kid_first_name: `Kid${i}`,
        kid_last_name: "Newal",
        status: "active",
        updated_at: "2026-08-05T00:00:00.000Z",
      });
    }
    const res = await v3AddKid(deps, addKidBody({ differentChild: true }), ctx);
    expect(res).toEqual({ kind: "capped" });
    expect(inserts(log)).toEqual([]);
    expect(store.fp_signup_attempts).toHaveLength(0);
  });

  it("consumed drafts do NOT count against the budget (they are bounded by the family cap instead)", async () => {
    const { store, deps } = harness();
    for (let i = 0; i < V3_MAX_ACTIVE_DRAFTS_PER_PARENT + 5; i += 1) {
      store.fp_onboarding_drafts.push({
        id: `draft-${i}`,
        parent_id: PARENT_ID,
        kid_first_name: `Kid${i}`,
        kid_last_name: "Newal",
        status: "consumed",
        updated_at: "2026-08-05T00:00:00.000Z",
      });
    }
    expect(await v3AddKid(deps, addKidBody(), ctx)).toMatchObject({ kind: "added" });
  });

  it("an uncountable budget fails CLOSED", async () => {
    const { store, deps } = harness({
      faults: { "select:fp_onboarding_drafts": { kind: "error", error: { message: "boom" } } },
    });
    expect(await v3AddKid(deps, addKidBody(), ctx)).toEqual({ kind: "failed" });
    expect(store.fp_signup_attempts).toHaveLength(0);
  });
});

/* ------------------------------------------------------- v3ProvisionKid */

/** Seed a live, named draft the way v3AddKid would have left it. */
async function seedDraft(
  deps: V3OnboardingDeps,
  store: Store,
  over: Row = {}
): Promise<string> {
  const res = await v3AddKid(deps, addKidBody(), ctx);
  if (res.kind !== "added") throw new Error(`seed failed: ${res.kind}`);
  const row = store.fp_onboarding_drafts.find((d) => d.id === res.draftId) as Row;
  Object.assign(row, over);
  return res.draftId;
}

describe("v3ProvisionKid — the happy path", () => {
  it("mints the child, writes the (empty) cover carry, then stamps the draft consumed LAST", async () => {
    const { store, deps, createChildCalls, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    const attemptId = store.fp_onboarding_drafts[0].signup_attempt_id;

    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res).toMatchObject({
      kind: "provisioned",
      childId: mintedChildIds[0],
      username: "remi.newal",
      firstName: "Remi",
    });
    if (res.kind === "provisioned") {
      expect(res.password.startsWith("iloveschool")).toBe(true);
    }

    // The mint is keyed on the DRAFT'S attempt, which is what makes a retry an
    // idempotent replay rather than a second child.
    expect(createChildCalls).toEqual([
      {
        attemptId,
        parentToken: ctx.parentToken,
        firstName: "Remi",
        lastName: "Newal",
        childPassword: expect.stringContaining("iloveschool"),
      },
    ]);

    // Consumption is stamped only AFTER createChild returned ok.
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      status: "consumed",
      child_id: mintedChildIds[0],
    });
  });

  it("refuses `no_draft` for a draft that is not this parent's", async () => {
    const { store, deps, createChildCalls } = harness();
    const draftId = await seedDraft(deps, store);
    const res = await v3ProvisionKid(deps, { draftId }, { ...ctx, parentId: "someone-else" });
    expect(res).toEqual({ kind: "refused", reason: "no_draft" });
    expect(createChildCalls).toEqual([]);
  });
});

describe("v3ProvisionKid — the idempotent-replay path", () => {
  it("re-reads fp_username from the CHILD ROW (never re-derives it) and returns an EMPTY password", async () => {
    // The replay branch of createChild returns the existing childId and NO
    // username, because it did not mint one this time. Re-deriving would produce
    // a DIFFERENT handle whenever a collision suffix was applied on the original
    // mint — i.e. it would show the family a login that does not exist.
    const { store, deps } = harness({
      createChild: async () => ({ ok: true, childId: CHILD_EXISTING }),
    });
    const draftId = await seedDraft(deps, store);
    store.children.push({
      id: CHILD_EXISTING,
      parent_id: PARENT_ID,
      first_name: "Remi",
      last_name: "Newal",
      // The suffixed handle the ORIGINAL mint claimed. Re-derivation would say
      // "remi.newal"; the row says otherwise, and the row wins.
      fp_username: "remi.newal2",
    });

    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res).toMatchObject({
      kind: "provisioned",
      childId: CHILD_EXISTING,
      username: "remi.newal2",
      // Genuinely unrecoverable — it was never persisted, by design — so the
      // screen is told the truth rather than shown an invented password.
      password: "",
    });
  });

  it("an unreadable fp_username yields an EMPTY username and a logged error, never a fabricated one", async () => {
    const { store, deps } = harness({
      createChild: async () => ({ ok: true, childId: CHILD_EXISTING }),
    });
    const draftId = await seedDraft(deps, store);
    store.children.push({ id: CHILD_EXISTING, parent_id: PARENT_ID, fp_username: null });

    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res).toMatchObject({ kind: "provisioned", username: "", password: "" });
    expect(errors.some((e) => e.includes("minted with no readable fp_username"))).toBe(true);
  });
});

describe("v3ProvisionKid — the cover artifact carry (v3 Unit 7, owner rework)", () => {
  const STORED = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

  it("copies the draft's RENDERED cover onto the child, byte-for-byte", async () => {
    // The owner requirement at the provisioning hop: the picture the parent
    // approved at signup becomes the child's one and only cover. Provisioning
    // has no renderer, so a copy is the only thing it can do — this pins that
    // it does it, and that the column is actually selected and written.
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    Object.assign(store.fp_onboarding_drafts[0], {
      cover_status: "final",
      cover_blob_key: null,
      cover_data_url: STORED,
      generation_count: 1,
    });

    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");

    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_cover_status: "final",
      fp_cover_blob_key: null,
      fp_cover_data_url: STORED,
      fp_cover_generation_count: 1,
    });
  });

  it("carries NO artifact for a draft that never generated one", async () => {
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_cover_status: "none",
      fp_cover_data_url: null,
    });
  });

  it("drops a malformed stored artifact and still provisions the child", async () => {
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    Object.assign(store.fp_onboarding_drafts[0], {
      cover_status: "final",
      cover_blob_key: null,
      cover_data_url: "https://evil.example/cover.svg",
      generation_count: 1,
    });

    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_cover_status: "final",
      fp_cover_data_url: null,
    });
  });
});

describe("v3ProvisionKid — the REDRAW inputs carry (v3 Unit 8, owner request)", () => {
  const STORED = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

  it("a provisioned child holds EVERYTHING a future redraw needs", async () => {
    // The whole point of the chunk, in one assertion. Age and answers live only
    // on `fp_onboarding_drafts`, and the reaper deletes those rows after 30
    // days — so without this carry every child provisioned today becomes
    // PERMANENTLY un-redrawable, and the deferred AI adapter would have nothing
    // but the name (a different palette, no age badge, generic captions: the
    // "one kid, two pictures" failure Unit 7 already diagnosed once).
    //
    // NOT a parity test. Parity is Unit 7's, and it is exact: the cover is one
    // string, copied, never re-derived. This asserts REDRAWABILITY.
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    await v3SaveStory(
      deps,
      { draftId, answers: { idea: "lemonade on hot days", matters: "nobody buys" } },
      ctx
    );
    Object.assign(store.fp_onboarding_drafts[0], {
      cover_status: "final",
      cover_blob_key: null,
      cover_data_url: STORED,
      generation_count: 1,
    });

    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");

    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    // NAME — from the mint itself.
    expect(child.first_name).toBe("Remi");
    expect(child.last_name).toBe("Newal");
    // AGE — the value the parent typed, not grade + 5.
    expect(child.fp_kid_age).toBe(9);
    // ANSWERS — verbatim.
    expect(child.fp_story_answers).toEqual({
      idea: "lemonade on hot days",
      matters: "nobody buys",
    });
    // ...and the cover that was already being carried, unaffected.
    expect(child.fp_cover_data_url).toBe(STORED);
    // The draft may now be reaped without losing anything.
    for (const key of ["first_name", "last_name", "fp_kid_age", "fp_story_answers"]) {
      expect(child[key], key).not.toBeUndefined();
    }
  });

  it("carries the redraw inputs even when the COVER carry degrades to `none`", async () => {
    // The coupling that must NOT exist. `planCoverCarry` nulls its fields when a
    // picture cannot be honestly claimed; the redraw inputs are true about the
    // KID regardless — and a child with no cover is exactly the child a redraw
    // is most needed for. Folding them into one plan would put them behind the
    // wrong guard.
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    await v3SaveStory(deps, { draftId, answers: { idea: "dog walking" } }, ctx);

    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_cover_status: "none",
      fp_cover_data_url: null,
      fp_kid_age: 9,
      fp_story_answers: { idea: "dog walking" },
    });
  });

  it("an EMPTY answer sheet carries as {} — 'the step ran and was skipped', not 'unknown'", async () => {
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_story_answers: {},
      fp_kid_age: 9,
    });
  });

  it("a NONSENSE age on the draft carries as NULL — children has no CHECK to catch it", async () => {
    // The child table deliberately carries no CHECK (populated-table rule), so
    // this function is the guard. Banking a nonsense age would hand the adapter
    // an input it cannot use and a row nothing would ever correct.
    for (const bad of [0, -1, 3, 26, 9.5, null]) {
      const { store, deps, mintedChildIds } = harness();
      const draftId = await seedDraft(deps, store);
      Object.assign(store.fp_onboarding_drafts[0], { kid_age: bad });
      expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind, String(bad)).toBe("provisioned");
      expect(
        (store.children.find((c) => c.id === mintedChildIds[0]) as Row).fp_kid_age,
        String(bad)
      ).toBeNull();
    }
  });

  it("the boundary ages the draft CHECK admits are carried, not clamped", async () => {
    for (const age of [4, 25]) {
      const { store, deps, mintedChildIds } = harness();
      const draftId = await seedDraft(deps, store);
      Object.assign(store.fp_onboarding_drafts[0], { kid_age: age });
      expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
      expect(
        (store.children.find((c) => c.id === mintedChildIds[0]) as Row).fp_kid_age,
        String(age)
      ).toBe(age);
    }
  });
});

describe("v3ProvisionKid — decoration never fails provisioning", () => {
  it("a cover-carry COPY failure degrades the child to status 'none' rather than pointing at bytes nobody wrote", async () => {
    const { store, deps, mintedChildIds } = harness({
      copyCoverBlob: async () => ({ ok: false }),
    });
    const draftId = await seedDraft(deps, store);
    const draftKey = blobKey({
      scope: "draft",
      ownerId: draftId,
      kind: "cover",
      ext: "png",
      sequence: 2,
    });
    Object.assign(store.fp_onboarding_drafts[0], {
      cover_status: "final",
      cover_blob_key: draftKey,
      generation_count: 2,
    });

    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res.kind).toBe("provisioned");

    // Two-store rule (1): a row may only claim a status implying a blob AFTER
    // the copy is confirmed. The generation count still carries, so a family
    // cannot reset their vendor spend by failing a copy.
    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child).toMatchObject({
      fp_cover_blob_key: null,
      fp_cover_status: "none",
      fp_cover_generation_count: 2,
    });
    expect(errors.some((e) => e.includes("cover carry copy failed"))).toBe(true);
  });

  it("an ABSENT copyCoverBlob (the Unit 4 seam, unwired today) degrades the same way", async () => {
    const { store, deps, mintedChildIds } = harness();
    const draftId = await seedDraft(deps, store);
    Object.assign(store.fp_onboarding_drafts[0], {
      cover_status: "final",
      cover_blob_key: blobKey({
        scope: "draft",
        ownerId: draftId,
        kind: "cover",
        ext: "png",
        sequence: 1,
      }),
      generation_count: 1,
    });
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    expect(store.children.find((c) => c.id === mintedChildIds[0])).toMatchObject({
      fp_cover_status: "none",
    });
  });

  it("a failed cover COLUMN write is logged and moved past — the child is minted and playable", async () => {
    const { store, deps } = harness({
      faults: { "update:children": { kind: "error", error: { message: "cover write boom" } } },
    });
    const draftId = await seedDraft(deps, store);
    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res.kind).toBe("provisioned");
    expect(errors.some((e) => e.includes("cover column write failed"))).toBe(true);
  });
});

/* ------------------------- the photo-consent decline tombstone (fpv03 U3) */

describe("the S04 photo decline — tombstone stamped at child creation, and the tombstone WINS", () => {
  it("photoDeclined rides the consent row's evidence blob, and provisioning stamps photo_consent_revoked_at FROM THE ROW'S OWN accepted_at (review FIX B)", async () => {
    const { store, deps, mintedChildIds } = harness();
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: true }), ctx);
    expect(res).toMatchObject({ kind: "added" });

    // The decline is DURABLE at add-kid time (the only store this signup
    // writes), not client state a refresh could lose.
    expect(store.fp_parental_consent[0].evidence).toMatchObject({ photo_declined: true });

    // The DB default would set accepted_at on insert; the fake store does not,
    // so seed it — the tombstone must equal THIS value, not the server clock,
    // which is what makes the strictly-after ordering a single-clock guarantee.
    const ACCEPTED_AT = "2026-08-09T10:00:00.000Z";
    store.fp_parental_consent[0].accepted_at = ACCEPTED_AT;

    const draftId = (res as { draftId: string }).draftId;
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");

    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child.photo_consent_revoked_at).toBe(ACCEPTED_AT);
    expect(errors.some((e) => e.includes("no readable accepted_at"))).toBe(false);
  });

  it("a consent row with NO readable accepted_at falls back to the server clock, loudly (FIX B's logged fallback)", async () => {
    const { store, deps, mintedChildIds } = harness();
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: true }), ctx);
    // No accepted_at seeded — the fallback path.
    const draftId = (res as { draftId: string }).draftId;
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");

    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child.photo_consent_revoked_at).toBe(new Date(1_700_000_000_000).toISOString());
    expect(errors.some((e) => e.includes("no readable accepted_at"))).toBe(true);
  });

  it("THE ORDERING INVARIANT: a decline in the SAME signup as the acceptance reads NOT covered", async () => {
    // The adversarial finding this pins: the verdict rule is "acceptance
    // strictly NEWER than tombstone at version >= anchor", and the default-ON
    // checkbox means the decline's tombstone lands in the same signup as (and
    // never before) the acceptance — so the tombstone must WIN. Executed
    // through the REAL write path (v3AddKid then v3ProvisionKid over the
    // shared store), then judged by the REAL gate rule.
    const { store, deps, mintedChildIds } = harness();
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: true }), ctx);
    const draftId = (res as { draftId: string }).draftId;
    await v3ProvisionKid(deps, { draftId }, ctx);

    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    const verdict = photoConsentVerdict({
      rows: store.fp_parental_consent.map((r) => ({
        policyVersion: r.policy_version as string,
        acceptedAt: (r.accepted_at ?? new Date(1_700_000_000_000).toISOString()) as string,
      })),
      revokedAt: child.photo_consent_revoked_at as string,
    });
    expect(verdict.ok).toBe(false);
    // Same-instant is the racing insert and it loses (strictly-after rule).
    if (!verdict.ok) expect(verdict.reason).toBe("pre_tombstone");
  });

  it("accepted (checkbox left ON, field absent) stamps NO tombstone and reads covered", async () => {
    const { store, deps, mintedChildIds } = harness();
    const res = await v3AddKid(deps, addKidBody(), ctx);
    const draftId = (res as { draftId: string }).draftId;
    await v3ProvisionKid(deps, { draftId }, ctx);

    expect(store.fp_parental_consent[0].evidence).not.toHaveProperty("photo_declined");
    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child.photo_consent_revoked_at).toBeUndefined();

    const verdict = photoConsentVerdict({
      rows: [
        {
          policyVersion: store.fp_parental_consent[0].policy_version as string,
          acceptedAt: new Date(1_700_000_000_000).toISOString(),
        },
      ],
      revokedAt: null,
    });
    expect(verdict.ok).toBe(true);
  });

  it("photoDeclined: false is a harmless no-op (fail-safe: absent/false = no tombstone)", async () => {
    const { store, deps } = harness();
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: false }), ctx);
    expect(res).toMatchObject({ kind: "added" });
    expect(store.fp_parental_consent[0].evidence).not.toHaveProperty("photo_declined");
  });

  it("a STRANDED tombstone write logs BOTH lines, leaves no stamp — and the gate STILL reads NOT covered (review Testing 0.85 + FIX A)", async () => {
    // The failure FIX A exists for, executed end-to-end: the decline landed in
    // the consent row's evidence, but the children UPDATE that stamps the
    // tombstone fails. Pre-FIX-A the missing tombstone silently REOPENED the
    // photo gate; now the decline rides the acceptance row into the verdict.
    // (The harness's createChild pushes the child row directly into the store,
    // so the fault below hits only the cover/tombstone UPDATE — same shape as
    // the "failed cover COLUMN write" test above.)
    const { store, deps, mintedChildIds } = harness({
      faults: { "update:children": { kind: "error", error: { message: "tombstone boom" } } },
    });
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: true }), ctx);
    const draftId = (res as { draftId: string }).draftId;
    const ACCEPTED_AT = "2026-08-09T10:00:00.000Z";
    store.fp_parental_consent[0].accepted_at = ACCEPTED_AT;

    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");

    // Both operator handles fired, and no stamp landed.
    expect(errors.some((e) => e.includes("cover column write failed"))).toBe(true);
    expect(errors.some((e) => e.includes("STRANDED PHOTO DECLINE"))).toBe(true);
    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child.photo_consent_revoked_at).toBeUndefined();

    // Post-FIX-A: the verdict reads the decline off the acceptance row itself,
    // so the stranded tombstone cannot reopen the gate.
    const verdict = photoConsentVerdict({
      rows: store.fp_parental_consent.map((r) => ({
        policyVersion: r.policy_version as string,
        acceptedAt: (r.accepted_at ?? null) as string | null,
        evidence: r.evidence,
      })),
      revokedAt: null,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("declined");
  });

  it("an unreadable evidence blob stamps NOTHING and logs loudly (documented fail-safe direction)", async () => {
    // The ONLY select against fp_parental_consent on this path is
    // provisioning's evidence read (v3AddKid only inserts there), so the fault
    // plan can sit on the whole run without touching the add.
    const { store, deps, mintedChildIds } = harness({
      faults: { "select:fp_parental_consent": { kind: "error", error: { message: "boom" } } },
    });
    const res = await v3AddKid(deps, addKidBody({ photoDeclined: true }), ctx);
    const draftId = (res as { draftId: string }).draftId;
    expect((await v3ProvisionKid(deps, { draftId }, ctx)).kind).toBe("provisioned");
    const child = store.children.find((c) => c.id === mintedChildIds[0]) as Row;
    expect(child.photo_consent_revoked_at).toBeUndefined();
    expect(errors.some((e) => e.includes("PHOTO DECLINE UNREADABLE"))).toBe(true);
  });
});

describe("v3ProvisionKid — a consumption-stamp failure never fails a successful mint", () => {
  it("returns `provisioned` and logs the STRANDED DRAFT line", async () => {
    // The stamp is the LAST write, and the child is already real when it runs.
    // Failing the request here would tell a family their kid's account was not
    // created when it was — and a retry would land on the replay path anyway.
    const { store, deps, mintedChildIds } = harness({
      faults: { "update:fp_onboarding_drafts": { kind: "no-rows" } },
    });
    const draftId = await seedDraft(deps, store);

    const res = await v3ProvisionKid(deps, { draftId }, ctx);
    expect(res).toMatchObject({ kind: "provisioned", childId: mintedChildIds[0] });

    // The draft is left `active` with a real child behind it — a reconciliation
    // problem the log names precisely enough to fix by hand.
    expect(store.fp_onboarding_drafts[0]).toMatchObject({ status: "active" });
    const stranded = errors.find((e) => e.includes("STRANDED DRAFT"));
    expect(stranded).toBeTruthy();
    expect(stranded).toContain(draftId);
    expect(stranded).toContain(mintedChildIds[0]);
  });
});

describe("v3ProvisionKid — refusals", () => {
  it("`outage` from the mint is `retryable` (the retry is the same idempotent call)", async () => {
    const { store, deps } = harness({
      createChild: async () => ({ ok: false, reason: "outage" }),
    });
    const draftId = await seedDraft(deps, store);
    expect(await v3ProvisionKid(deps, { draftId }, ctx)).toEqual({ kind: "retryable" });
    // Nothing consumed — the draft is still there for the retry.
    expect(store.fp_onboarding_drafts[0]).toMatchObject({ status: "active" });
  });

  it("every other refusal is surfaced with its reason, and the draft stays live", async () => {
    const { store, deps } = harness({
      createChild: async () => ({ ok: false, reason: "consent_required", detail: "stale" }),
    });
    const draftId = await seedDraft(deps, store);
    expect(await v3ProvisionKid(deps, { draftId }, ctx)).toEqual({
      kind: "refused",
      reason: "consent_required",
      detail: "stale",
    });
    expect(store.fp_onboarding_drafts[0]).toMatchObject({ status: "active" });
  });
});

/* ------------------------------------------------------ story + the loader */

describe("v3SaveStory — only KNOWN question ids reach the draft's jsonb", () => {
  it("stores known ids, drops unknown keys, and bumps the reaping clock", async () => {
    const { store, deps } = harness();
    const draftId = await seedDraft(deps, store);
    store.fp_onboarding_drafts[0].updated_at = "2020-01-01T00:00:00.000Z";

    const res = await v3SaveStory(
      deps,
      { draftId, answers: { matters: "  Soccer  ", nope: "arbitrary jsonb" } },
      ctx
    );
    expect(res).toEqual({ kind: "saved" });
    expect(store.fp_onboarding_drafts[0].answers).toEqual({ matters: "Soccer" });
    expect(store.fp_onboarding_drafts[0].updated_at).toBe(
      new Date(1_700_000_000_000).toISOString()
    );
  });

  it("cannot write a CONSUMED draft (finished work is immutable)", async () => {
    const { store, deps } = harness();
    const draftId = await seedDraft(deps, store);
    await v3ProvisionKid(deps, { draftId }, ctx);
    expect(await v3SaveStory(deps, { draftId, answers: { matters: "late" } }, ctx)).toEqual({
      kind: "failed",
    });
  });
});

describe("loadV3OnboardingState", () => {
  it("resumes the most recently touched ACTIVE draft and never a consumed one", async () => {
    const { store, deps } = harness();
    await seedDraft(deps, store);
    store.fp_onboarding_drafts[0].updated_at = "2026-01-01T00:00:00.000Z";
    await v3AddKid(deps, addKidBody({ fullName: "Sam Newal", age: "11" }), ctx);
    store.fp_onboarding_drafts[1].updated_at = "2026-06-01T00:00:00.000Z";

    const state = await loadV3OnboardingState(deps, {
      parentId: PARENT_ID,
      parentVerified: true,
    });
    expect(state.draft?.firstName).toBe("Sam");
    // The OTHER live draft is offered as an existing kid — the resumed one is
    // excluded so correcting a typo on it never trips the duplicate guard.
    expect(state.existingKids).toEqual([
      { id: store.fp_onboarding_drafts[0].id, kind: "draft", firstName: "Remi", lastName: "Newal" },
    ]);
    expect(state.facts).toMatchObject({ hasDraft: true, kidNamed: true, childCreated: false });
  });

  it("an unverified parent gets the empty state without touching the database", async () => {
    const { store, deps } = harness();
    await seedDraft(deps, store);
    const state = await loadV3OnboardingState(deps, {
      parentId: PARENT_ID,
      parentVerified: false,
    });
    expect(state).toEqual({
      draft: null,
      existingKids: [],
      // fpv03 U3: coverSettled/storyStarted left V3FlowFacts with the
      // cover/story steps' retirement from signup.
      facts: {
        parentVerified: false,
        hasDraft: false,
        kidNamed: false,
        childCreated: false,
      },
    });
  });
});
