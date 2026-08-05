import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import {
  authorizeCoverGeneration,
  performCoverGeneration,
  TEMPLATE_COVER_STATUS,
  type CoverCaller,
  type CoverDeps,
} from "../cover-core";
import {
  COVER_GENERATION_CAP,
  isCoverInfraFailure,
  stagesForMode,
  type CoverStage,
} from "../cover-rules";
import { isTerminalCoverStatus, type CoverStatus } from "@/app/fp/lib/cover-store-rules";

/**
 * The cover core (plan Unit 4) driven by EXECUTION against the stateful
 * fake-supabase harness — the same shape as
 * app/api/fp/signup/__tests__/{child-core,consent-core}.test.ts and
 * app/lib/v3-signup/__tests__/v3-onboarding-core.test.ts. No `vi.mock` of
 * Supabase anywhere: every assertion is against state a prior step persisted.
 *
 * ── THESE TESTS ASSERT THE NEGATIVE ──
 * "Refused" is not enough for an authorization test: a function can refuse
 * AFTER doing the very thing that mattered. So the harness counts two things a
 * refusal must never cause:
 *   - `dbCalls`     — how many times the SERVICE-ROLE CLIENT FACTORY was
 *                     invoked. Zero means the privileged key was never even
 *                     reached, which is why `CoverDeps.db` is a factory.
 *   - `renderCalls` — how many times the compositor ran. Zero means no
 *                     generation work happened. (Under the AI adapter this is
 *                     the vendor call, and the same assertion covers it.)
 * Plus the store itself: a refusal must leave `generation_count` and
 * `cover_status` exactly as it found them.
 */

const PARENT = "parent-a";
const OTHER_PARENT = "parent-b";
const ATTEMPT = "attempt-1";

const parentCaller: CoverCaller = { kind: "parent", parentId: PARENT };

type HarnessCfg = {
  caller?: CoverCaller | null;
  faults?: FaultPlan;
  /** Overrides for the seeded draft row. */
  draft?: Row;
  /** Overrides for the seeded consent row; `null` seeds no consent at all. */
  consent?: Row | null;
  children?: Row[];
  env?: { COVER_AI_LIVE?: string };
  generateImage?: CoverDeps["generateImage"];
};

function harness(cfg: HarnessCfg = {}) {
  const store: Store = newStore();
  const draftId = randomUUID();
  store.fp_onboarding_drafts = [
    {
      id: draftId,
      parent_id: PARENT,
      signup_attempt_id: ATTEMPT,
      child_id: null,
      kid_first_name: "Remi",
      kid_last_name: "Newal",
      kid_age: 11,
      answers: {},
      cover_status: "none",
      cover_blob_key: null,
      generation_count: 0,
      status: "active",
      updated_at: "2026-08-05T00:00:00.000Z",
      ...(cfg.draft ?? {}),
    },
  ];
  if (cfg.consent !== null) {
    store.fp_parental_consent = [
      {
        id: "consent-1",
        signup_attempt_id: ATTEMPT,
        parent_id: PARENT,
        child_id: null,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: "2026-08-05T00:00:00.000Z",
        revoked_at: null,
        ...(cfg.consent ?? {}),
      },
    ];
  }
  if (cfg.children) store.children = cfg.children;

  const client = fakeClient(store, cfg.faults);
  let dbCalls = 0;
  let renderCalls = 0;
  const stages: CoverStage[] = [];

  const deps: CoverDeps = {
    authenticate: async () => (cfg.caller === undefined ? parentCaller : cfg.caller),
    db: () => {
      dbCalls += 1;
      return client as unknown as ReturnType<CoverDeps["db"]>;
    },
    now: () => 1_700_000_000_000,
    env: cfg.env ?? {},
    generateImage: cfg.generateImage,
    renderCover: (input) => {
      renderCalls += 1;
      return `data:image/svg+xml;base64,${Buffer.from(String(input.firstName)).toString("base64")}`;
    },
  };

  const emit = (e: { stage: CoverStage }) => stages.push(e.stage);
  const draftRow = () => store.fp_onboarding_drafts[0];

  return {
    store,
    draftId,
    deps,
    stages,
    emit,
    draftRow,
    counts: () => ({ dbCalls, renderCalls }),
  };
}

/* ------------------------------------------------------------ authorization */

describe("authorization runs before ANY work", () => {
  it("refuses an unauthenticated caller without constructing the privileged client", async () => {
    const h = harness({ caller: null });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unauthenticated");
    // THE NEGATIVE: the service-role factory was never invoked and nothing drew.
    expect(h.counts()).toEqual({ dbCalls: 0, renderCalls: 0 });
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });

  it("refuses a caller who does not own the target draft, and leaves the row untouched", async () => {
    const h = harness({ caller: { kind: "parent", parentId: OTHER_PARENT } });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    // Same refusal as a draft that does not exist: a caller must not be able to
    // learn which draft ids are real.
    if (!res.ok) expect(res.reason).toBe("not_found");
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });

  it("does NOT treat a draft id as authorization — a real draft id from a stranger still refuses", async () => {
    const h = harness({ caller: { kind: "parent", parentId: OTHER_PARENT } });
    // The id is genuine and the stranger holds it; ownership is what decides.
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
  });

  it("refuses the kid Bearer path as a guarded seam, before the privileged client", async () => {
    const h = harness({ caller: { kind: "kid_bearer", childId: randomUUID() } });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("kid_path_closed");
    expect(h.counts()).toEqual({ dbCalls: 0, renderCalls: 0 });
  });

  it("refuses a consumed draft as not_found", async () => {
    const h = harness({ draft: { status: "consumed" } });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });
});

/* ------------------------------------------------------------- photo door */

describe("the photo path is CLOSED while COVER_AI_LIVE is off", () => {
  it("refuses a multipart body from the content type alone, storing nothing", async () => {
    const h = harness();
    const res = await authorizeCoverGeneration(h.deps, {
      body: undefined,
      photoContentType: "multipart/form-data; boundary=x",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("photo_closed");
    // Nothing read the photo, nothing constructed a privileged client, and no
    // row anywhere gained a photo key.
    expect(h.counts()).toEqual({ dbCalls: 0, renderCalls: 0 });
    expect(h.draftRow().photo_blob_key ?? null).toBeNull();
    expect(h.draftRow().generation_count).toBe(0);
  });

  it("refuses a photo carried in the JSON body", async () => {
    const h = harness();
    const res = await authorizeCoverGeneration(h.deps, {
      body: { draftId: h.draftId, photo: "data:image/png;base64,AAAA" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("photo_closed");
    expect(h.counts().dbCalls).toBe(0);
    expect(h.draftRow().photo_blob_key ?? null).toBeNull();
  });

  it("stays closed even with COVER_AI_LIVE=1, because a flag is not an adapter", async () => {
    const h = harness({ env: { COVER_AI_LIVE: "1" } });
    const res = await authorizeCoverGeneration(h.deps, {
      body: { draftId: h.draftId, photo: "x" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("photo_closed");
  });

  it("opens the photo door when the flag AND an adapter are both present", async () => {
    const h = harness({
      env: { COVER_AI_LIVE: "1" },
      generateImage: async () => ({ ok: false, reason: "not-implemented" }),
    });
    const res = await authorizeCoverGeneration(h.deps, {
      body: { draftId: h.draftId, photo: "x" },
    });
    // The seam being proven is that the PHOTO DOOR opened — the request is no
    // longer refused as `photo_closed`. It still cannot succeed, because phase
    // two has no vendor branch, and that is now decided here in phase one
    // (`decideGenerationFeasible`) rather than after a slot has been spent.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).not.toBe("photo_closed");
      expect(res.reason).toBe("outage");
    }
  });
});

/* ------------------------------------------------------------- feasibility */

describe("a request phase two cannot perform never reserves (review FIX 3)", () => {
  it("refuses ai mode in PHASE ONE, before the privileged client and before the CAS", async () => {
    const h = harness({
      env: { COVER_AI_LIVE: "1" },
      // An adapter is injected, so `resolveCoverMode` answers "ai" — exactly the
      // day-the-adapter-lands scenario. There is still no vendor branch in
      // `performCoverGeneration`, so the request is doomed.
      generateImage: async () => ({ ok: false, reason: "not-implemented" }),
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("outage");
    // THE END STATE, which is the whole point: no durable slot was spent and the
    // row was never moved to the non-terminal `generating`.
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
    // And it never even reached the service-role key.
    expect(h.counts()).toEqual({ dbCalls: 0, renderCalls: 0 });
  });

  it("leaves the whole cap intact across repeated doomed ai requests", async () => {
    const h = harness({
      env: { COVER_AI_LIVE: "1" },
      generateImage: async () => ({ ok: false, reason: "not-implemented" }),
    });
    for (let i = 0; i < COVER_GENERATION_CAP + 2; i += 1) {
      const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
      expect(res.ok).toBe(false);
    }
    // The old ordering burned one slot per attempt and would have exhausted the
    // family's cap on covers that never existed.
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });
});

/* ---------------------------------------------------------------- consent */

describe("the photo/cover consent gate runs before any generation", () => {
  it("refuses a consent below the photo anchor", async () => {
    const h = harness({ consent: { policy_version: "2026-08-03.1" } });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("consent_required");
      expect(res.detail).toBe("stale");
    }
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
  });

  it("refuses when the child's tombstone post-dates every surviving consent", async () => {
    const childId = randomUUID();
    const h = harness({
      draft: { child_id: childId },
      consent: { child_id: childId, accepted_at: "2026-08-05T00:00:00.000Z" },
      children: [
        {
          id: childId,
          parent_id: PARENT,
          // Revoked AFTER the consent above was accepted.
          photo_consent_revoked_at: "2026-08-06T00:00:00.000Z",
        },
      ],
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("consent_required");
      expect(res.detail).toBe("pre_tombstone");
    }
    expect(h.counts().renderCalls).toBe(0);
  });

  it("refuses when there is no consent row at all", async () => {
    const h = harness({ consent: null });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toBe("no_consent");
  });

  it("fails CLOSED when the tombstone cannot be read", async () => {
    const childId = randomUUID();
    const h = harness({
      draft: { child_id: childId },
      consent: { child_id: childId },
      children: [{ id: childId, parent_id: PARENT, photo_consent_revoked_at: null }],
      faults: { "select:children": { kind: "error", error: { message: "boom" } } },
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("outage");
  });
});

/* -------------------------------------------------------------------- cap */

describe("the generation cap lives on the ROW", () => {
  it("refuses at the cap without doing any work", async () => {
    const h = harness({ draft: { generation_count: COVER_GENERATION_CAP } });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("cap_exhausted");
    expect(h.counts().renderCalls).toBe(0);
    // The refusal wrote nothing at all.
    expect(h.draftRow().generation_count).toBe(COVER_GENERATION_CAP);
    expect(h.draftRow().cover_status).toBe("none");
  });

  it("counts every generation on the row and stops at the cap", async () => {
    const h = harness();
    for (let i = 1; i <= COVER_GENERATION_CAP; i += 1) {
      const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
      expect(authz.ok).toBe(true);
      if (!authz.ok) return;
      const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);
      expect(done.kind).toBe("ready");
      // DURABLE: the count is read back out of the store, not out of a closure.
      expect(h.draftRow().generation_count).toBe(i);
    }
    const extra = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.reason).toBe("cap_exhausted");
    expect(h.draftRow().generation_count).toBe(COVER_GENERATION_CAP);
  });
});

/* ------------------------------------------------------------ the happy path */

describe("template generation", () => {
  it("emits EXACTLY the stages the template path performs, in order", async () => {
    const h = harness();
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(authz.ok).toBe(true);
    if (!authz.ok) return;

    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    // The contract: the stage sequence IS the work performed. Two durable
    // transitions (the reservation CAS, then the settle), two events, no
    // fabricated intermediates.
    expect(h.stages).toEqual([...stagesForMode("template")]);
    expect(h.stages).toEqual(["reserved", "composed"]);
    expect(done.kind).toBe("ready");
    if (done.kind === "ready") {
      expect(done.coverUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
      expect(done.status).toBe(TEMPLATE_COVER_STATUS);
      expect(done.generationCount).toBe(1);
    }
  });

  it("settles the row to a picture status that names NO blob key", async () => {
    const h = harness();
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(h.draftRow().cover_status).toBe(TEMPLATE_COVER_STATUS);
    // THE WHOLE POINT: no bytes were written, so no key is claimed.
    expect(h.draftRow().cover_blob_key).toBeNull();
    expect(h.draftRow().photo_blob_key ?? null).toBeNull();
    expect(h.draftRow().updated_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("refuses when the RESERVATION write errors, having drawn nothing", async () => {
    // The first `update:fp_onboarding_drafts` of the run IS the reservation CAS.
    const h = harness({
      faults: {
        "update:fp_onboarding_drafts": { kind: "error", error: { message: "boom" }, onCalls: [1] },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("refused");
    if (done.kind === "refused") expect(done.reason).toBe("outage");
    expect(h.stages).toEqual([]);
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });

  /**
   * ── THE SETTLE-FAILURE BRANCH, ACTUALLY REACHED (review FIX 5) ──
   * The previous version of this test faulted EVERY `update:fp_onboarding_drafts`
   * call, so the RESERVATION failed first and this branch was never executed —
   * its assertions described a different path entirely. `onCalls` scopes the
   * fault to the settle's own call ordinals: 1 is the reservation, 2..4 are the
   * three settle attempts, 5 is the compensation.
   */
  it("REFUSES rather than handing back a cover whose row is stuck on `generating`", async () => {
    const h = harness({
      faults: {
        "update:fp_onboarding_drafts": {
          kind: "error",
          error: { message: "boom" },
          // Every settle attempt AND the compensation. Call 1 (the reservation)
          // is deliberately left to land, so the row really does sit on
          // `generating` — which is what makes this the branch under test.
          onCalls: [2, 3, 4, 5],
        },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    // It got as far as reserving and composing, so the reservation DID land…
    expect(h.stages).toEqual(["reserved"]);
    expect(h.counts().renderCalls).toBe(1);
    expect(h.draftRow().generation_count).toBe(1);
    // …and the row is stranded on the one non-terminal status, because even the
    // compensation could not be written.
    expect(h.draftRow().cover_status).toBe("generating");
    // THE FIX: the caller is NOT told "here is your cover" with a status the row
    // is stuck in. A stranded row is our fault, so it is an honest `outage`.
    expect(done.kind).toBe("refused");
    if (done.kind === "refused") expect(done.reason).toBe("outage");
  });

  it("retries the settle, and a transient fault costs nothing", async () => {
    const h = harness({
      faults: {
        // Call 1 = reservation (lands). Call 2 = first settle attempt (fails).
        // Call 3 = the retry, which is allowed through.
        "update:fp_onboarding_drafts": {
          kind: "error",
          error: { message: "transient" },
          onCalls: [2],
        },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("ready");
    if (done.kind === "ready") expect(done.status).toBe(TEMPLATE_COVER_STATUS);
    expect(h.stages).toEqual(["reserved", "composed"]);
    expect(h.draftRow().cover_status).toBe(TEMPLATE_COVER_STATUS);
    expect(h.draftRow().generation_count).toBe(1);
  });

  it("COMPENSATES the row off `generating` when the settle will not persist", async () => {
    const h = harness({
      faults: {
        // The three settle attempts fail; the compensation (call 5) lands.
        "update:fp_onboarding_drafts": {
          kind: "error",
          error: { message: "boom" },
          onCalls: [2, 3, 4],
        },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("refused");
    // The row rests in a TERMINAL status, so nothing downstream can be stranded
    // by it and the family's next redraw behaves normally.
    expect(h.draftRow().cover_status).toBe("none");
    expect(isTerminalCoverStatus(h.draftRow().cover_status as CoverStatus)).toBe(true);
    // The slot is still spent: a durable counter does not refund a real attempt.
    expect(h.draftRow().generation_count).toBe(1);
  });

  it("settles to `final`, an honestly TERMINAL status (review FIX 4)", async () => {
    const h = harness();
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(TEMPLATE_COVER_STATUS).toBe("final");
    // NOT `fallback_pending_regen`: nothing in this build queues a regeneration,
    // and no cron, reaper or backfill reprocesses that status — a family left in
    // it would wait forever for work that was never scheduled.
    expect(TEMPLATE_COVER_STATUS).not.toBe("fallback_pending_regen");
    expect(isTerminalCoverStatus(TEMPLATE_COVER_STATUS)).toBe(true);
    if (done.kind === "ready") expect(done.status).toBe("final");
    // It is a picture-implying status carried by a row with NO blob key, which
    // is legal for exactly one reason: the picture is derived.
    expect(h.draftRow().cover_status).toBe("final");
    expect(h.draftRow().cover_blob_key).toBeNull();
  });
});

/* ------------------------------------------------- the reservation CAS loop */

/**
 * ── THE DURABLE CAP UNDER CONCURRENCY (review FIX 6) ──
 * `reserveGenerationSlot`'s lose-the-race → re-read → retry loop and its
 * exhaustion branch are the whole reason the cap is durable rather than
 * advisory, and neither had a test. The harness models a lost CAS with
 * `no-rows` (the statement affected zero rows) plus `concurrently` (what the
 * winner wrote while we matched nothing) — the second half matters, because
 * without it the re-read would observe our own stale value and "converging"
 * would prove nothing.
 */
describe("the reservation CAS under concurrency", () => {
  it("re-reads the winner's value and converges on the next slot", async () => {
    const h = harness({
      faults: {
        "update:fp_onboarding_drafts": {
          kind: "no-rows",
          // Only the FIRST attempt loses; the retry is allowed to land.
          onCalls: [1],
          // The concurrent writer took slot 1 while our predicate
          // (generation_count = 0) matched nothing.
          concurrently: (rows) => {
            rows[0].generation_count = 1;
            rows[0].cover_status = "generating";
          },
        },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("ready");
    // It did NOT blindly rewrite `seen + 1` from its own stale read (which would
    // have written 1 again and handed the family a free extra generation): it
    // re-read 1 and reserved 2.
    if (done.kind === "ready") expect(done.generationCount).toBe(2);
    expect(h.draftRow().generation_count).toBe(2);
    expect(h.draftRow().cover_status).toBe(TEMPLATE_COVER_STATUS);
    expect(h.stages).toEqual(["reserved", "composed"]);
  });

  it("gives up as `busy` — NOT as an outage, and NOT with a corrupted count", async () => {
    const h = harness({
      // Every CAS loses: sustained contention on one row, which is the only
      // thing that can exhaust COVER_RESERVE_CAS_RETRIES.
      faults: { "update:fp_onboarding_drafts": { kind: "no-rows" } },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("refused");
    if (done.kind === "refused") {
      expect(done.reason).toBe("busy");
      // And `busy` is a real attempt: its rate-limit strike is NOT refunded.
      // Contention on one draft row is produced by the caller, so refunding it
      // would make hammering the reservation free (review FIX 1).
      expect(isCoverInfraFailure(done.reason)).toBe(false);
    }
    // Nothing was drawn and the durable counter is exactly as it was found.
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });

  it("stops at `not_found` rather than looping when the draft leaves `active`", async () => {
    const h = harness({
      faults: {
        "update:fp_onboarding_drafts": {
          kind: "no-rows",
          concurrently: (rows) => {
            // Provisioning consumed the draft mid-flight.
            rows[0].status = "consumed";
          },
        },
      },
    });
    const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    if (!authz.ok) throw new Error("expected authorization to pass");
    const done = await performCoverGeneration(h.deps, authz.authorized, h.emit);

    expect(done.kind).toBe("refused");
    if (done.kind === "refused") expect(done.reason).toBe("not_found");
    expect(h.draftRow().generation_count).toBe(0);
  });
});

/* --------------------------------------------- every DB read fails CLOSED */

/**
 * ── ALL FOUR READS, NOT JUST THE LAST (review FIX 7) ──
 * `authorizeCoverGeneration` has four independent DB reads that each answer
 * `outage` on error: the draft read, the consent-by-attempt read, the
 * consent-by-child read, and the tombstone read. Only the tombstone was covered.
 * The two consent reads are the SAME `select:fp_parental_consent` key, so
 * separating them is exactly what the harness's `onCalls` ordinals are for.
 */
describe("every authorization read fails CLOSED", () => {
  const childId = randomUUID();
  const withChild = {
    draft: { child_id: childId },
    consent: { child_id: childId },
    children: [{ id: childId, parent_id: PARENT, photo_consent_revoked_at: null }],
  };

  it("refuses when the DRAFT read errors, without drawing or writing", async () => {
    const h = harness({
      faults: { "select:fp_onboarding_drafts": { kind: "error", error: { message: "boom" } } },
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("outage");
    // Never `not_found`: an unreadable draft is not an absent one, and answering
    // `not_found` would turn a DB blip into a wrong story for the family.
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
    expect(h.draftRow().cover_status).toBe("none");
  });

  it("refuses when the consent-BY-ATTEMPT read errors", async () => {
    const h = harness({
      ...withChild,
      // Ordinal 1 of select:fp_parental_consent is the attempt-scoped read.
      faults: {
        "select:fp_parental_consent": {
          kind: "error",
          error: { message: "boom" },
          onCalls: [1],
        },
      },
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    // An unreadable consent is NOT a granted consent.
    if (!res.ok) expect(res.reason).toBe("outage");
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
  });

  it("refuses when the consent-BY-CHILD read errors", async () => {
    const h = harness({
      ...withChild,
      // Ordinal 2 is the child-scoped read; ordinal 1 is allowed to succeed, so
      // this proves the SECOND branch rather than re-proving the first.
      faults: {
        "select:fp_parental_consent": {
          kind: "error",
          error: { message: "boom" },
          onCalls: [2],
        },
      },
    });
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("outage");
    expect(h.counts().renderCalls).toBe(0);
    expect(h.draftRow().generation_count).toBe(0);
  });
});

/* ----------------------------------------------------------- request shape */

describe("request parsing", () => {
  it("refuses a malformed body AFTER authentication, never before", async () => {
    const h = harness();
    const res = await authorizeCoverGeneration(h.deps, { body: { draftId: "not-a-uuid" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_request");
    // Parsing happened, but no privileged client was built for a bad body.
    expect(h.counts().dbCalls).toBe(0);
  });
});
