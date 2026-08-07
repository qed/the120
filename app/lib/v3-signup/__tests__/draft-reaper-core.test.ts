import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { blobKey } from "@/app/fp/lib/cover-store-rules";
import { reapOnboardingDrafts, type DraftReaperDeps } from "../draft-reaper-core";
import {
  DRAFT_RETENTION_MS,
  ORPHAN_ATTEMPT_MIN_AGE_MS,
  RESIDUAL_PHOTO_MIN_AGE_MS,
} from "../draft-reaper-rules";

/**
 * The draft reaper, driven by EXECUTION against the stateful fake-supabase
 * harness (whole-branch review, finding 2). Everything this file asserts is a
 * claim about a SEQUENCE against shared state — the claim-then-delete-then-null
 * order, its idempotent re-run, and the fact that a live family's draft survives
 * the whole pass — and only an executing test over one mutable store can hold
 * those.
 */

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

type Cfg = {
  faults?: FaultPlan;
  blobConfigured?: boolean;
  deleteBlob?: (key: string) => Promise<"deleted" | "missing" | "error">;
};

function harness(cfg: Cfg = {}) {
  const store = newStore();
  store.fp_onboarding_drafts = [];
  store.fp_signup_attempts = [];
  store.fp_parental_consent = [];
  const deletedKeys: string[] = [];
  const deps: DraftReaperDeps = {
    db: fakeClient(store, cfg.faults) as unknown as DraftReaperDeps["db"],
    blobConfigured: cfg.blobConfigured ?? false,
    deleteBlob: cfg.deleteBlob
      ? async (key) => {
          deletedKeys.push(key);
          return cfg.deleteBlob!(key);
        }
      : undefined,
    now: () => NOW,
  };
  return { store, deps, deletedKeys };
}

/** A draft namespaced the way `blobKey` builds them, so `planSubjectBlobDeletes`
 *  agrees the key belongs to this draft. */
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const photoKey = blobKey({ scope: "draft", ownerId: DRAFT_ID, kind: "photo" });
const coverKey = blobKey({ scope: "draft", ownerId: DRAFT_ID, kind: "cover", sequence: 1 });

const abandonedDraft = (over: Record<string, unknown> = {}) => ({
  id: DRAFT_ID,
  parent_id: "parent-1",
  status: "active",
  cover_status: "final",
  child_id: null,
  updated_at: isoAgo(DRAFT_RETENTION_MS + DAY),
  photo_blob_key: null,
  cover_blob_key: null,
  ...over,
});

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------- the sweep */

describe("reapOnboardingDrafts — abandoned drafts", () => {
  it("flips an abandoned draft to `reaped` and says so honestly on the cover too", async () => {
    const { store, deps } = harness();
    store.fp_onboarding_drafts.push(abandonedDraft());

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.ok).toBe(true);
    expect(summary.drafts).toMatchObject({ reaped: 1, raced: 0 });
    // A STATUS FLIP, not a row delete: the dashboard shows the reaped state.
    expect(store.fp_onboarding_drafts).toHaveLength(1);
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      status: "reaped",
      cover_status: "reaped",
    });
  });

  it("is IDEMPOTENT — a second run finds nothing left to do", async () => {
    const { store, deps } = harness();
    store.fp_onboarding_drafts.push(abandonedDraft());

    await reapOnboardingDrafts(deps);
    const second = await reapOnboardingDrafts(deps);

    expect(second.ok).toBe(true);
    expect(second.drafts.reaped).toBe(0);
    expect(store.fp_onboarding_drafts[0].status).toBe("reaped");
  });
});

describe("the boundary: a LIVE family's draft survives the whole pass", () => {
  it("leaves an in-progress draft, a resumed one, and one carried to a child", async () => {
    // The failure this guards is strictly worse than not reaping at all, so it
    // is asserted against the STORE after a full run, not against a verdict.
    const { store, deps } = harness();
    store.fp_onboarding_drafts.push(
      // Started today.
      abandonedDraft({ id: "d-fresh", updated_at: isoAgo(DAY) }),
      // Created 40 days ago, RESUMED today — `updated_at` is the reaping clock.
      abandonedDraft({ id: "d-resumed", updated_at: isoAgo(2 * DAY) }),
      // Old and abandoned-looking, but a child was minted from it.
      abandonedDraft({ id: "d-carried", child_id: "child-1" }),
      // An unreadable clock must never read as "infinitely old".
      abandonedDraft({ id: "d-noclock", updated_at: null })
    );

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.drafts.reaped).toBe(0);
    expect(store.fp_onboarding_drafts.every((d) => d.status === "active")).toBe(true);
    // Only the carried draft is even SCANNED: the retention cutoff is pushed
    // into the query, so a fresh, a resumed and a clockless row never come
    // back at all (in Postgres `updated_at < cutoff` is NULL — excluded — for
    // the clockless one). The query is the first line; `draftReapVerdict`
    // re-checks the bound for everything that does come back, which is where
    // the fail-closed rules are pinned (draft-reaper-rules.test.ts).
    expect(summary.drafts.skipped).toEqual({ carried_to_child: 1 });
  });

  it("the CLAIM re-asserts the guard at the WRITE: a draft provisioned between read and write is untouched", async () => {
    // `concurrently` models the other writer landing after our statement: the
    // read saw an abandoned draft, but by the time the CAS ran the family had
    // provisioned. Zero rows matched — the designed outcome, not a fault.
    const { store, deps } = harness({
      faults: {
        "update:fp_onboarding_drafts": {
          kind: "no-rows",
          concurrently: (rows) => {
            rows[0].child_id = "child-1";
          },
        },
      },
    });
    store.fp_onboarding_drafts.push(abandonedDraft());

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.drafts).toMatchObject({ reaped: 0, raced: 1 });
    expect(store.fp_onboarding_drafts[0].status).toBe("active");
    expect(summary.ok).toBe(true);
  });
});

/* ------------------------------------------------------- external objects */

describe("the external objects: OBJECT BEFORE THE POINTER THAT NAMES IT", () => {
  it("deletes both objects, then nulls exactly the columns the store confirmed", async () => {
    const { store, deps, deletedKeys } = harness({
      blobConfigured: true,
      deleteBlob: async () => "deleted",
    });
    store.fp_onboarding_drafts.push(
      abandonedDraft({ photo_blob_key: photoKey, cover_blob_key: coverKey })
    );

    const summary = await reapOnboardingDrafts(deps);

    expect(deletedKeys).toEqual([photoKey, coverKey]);
    expect(summary.blobs).toMatchObject({ deleted: 2, errored: 0, unconfigured: 0 });
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      status: "reaped",
      photo_blob_key: null,
      cover_blob_key: null,
    });
    expect(summary.ok).toBe(true);
  });

  it("an ALREADY-GONE object is success — a completed erasure, not a failure", async () => {
    const { store, deps } = harness({
      blobConfigured: true,
      deleteBlob: async () => "missing",
    });
    store.fp_onboarding_drafts.push(abandonedDraft({ photo_blob_key: photoKey }));

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.blobs).toMatchObject({ missing: 1, errored: 0 });
    expect(summary.ok).toBe(true);
    expect(store.fp_onboarding_drafts[0].photo_blob_key).toBeNull();
  });

  it("a store OUTAGE strands, LEAVES THE KEY, and the next run finishes the job", async () => {
    // The rule the erasure learning states: a store failure must be loud, must
    // preserve the row that names the key so a retry can find it, and must fail
    // the run. Nulling the key here would make the bytes unreachable forever.
    let down = true;
    const { store, deps } = harness({
      blobConfigured: true,
      deleteBlob: async () => (down ? "error" : "deleted"),
    });
    store.fp_onboarding_drafts.push(abandonedDraft({ photo_blob_key: photoKey }));

    const first = await reapOnboardingDrafts(deps);
    expect(first.ok).toBe(false);
    expect(first.blobs.errored).toBe(1);
    expect(first.stranded.some((s) => s.startsWith("blob:error:"))).toBe(true);
    // Claimed, but the pointer SURVIVES — that is what makes the retry findable.
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      status: "reaped",
      photo_blob_key: photoKey,
    });

    down = false;
    const second = await reapOnboardingDrafts(deps);
    expect(second.ok).toBe(true);
    expect(second.drafts.residualSwept).toBe(1);
    expect(store.fp_onboarding_drafts[0].photo_blob_key).toBeNull();
  });

  it("NO ADAPTER + a real key is a STRAND, never a benign skip", async () => {
    // Today every blob key in production is NULL, so this never fires. It is
    // the alarm for the day the AI path starts writing objects and this deps
    // factory was not updated with it.
    const { store, deps } = harness({ blobConfigured: false });
    store.fp_onboarding_drafts.push(abandonedDraft({ photo_blob_key: photoKey }));

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.ok).toBe(false);
    expect(summary.blobs.unconfigured).toBe(1);
    expect(store.fp_onboarding_drafts[0].photo_blob_key).toBe(photoKey);
    expect(errors.some((e) => e.includes("no blob adapter is configured"))).toBe(true);
  });

  it("refuses a key outside the draft's own namespace", async () => {
    const { store, deps, deletedKeys } = harness({
      blobConfigured: true,
      deleteBlob: async () => "deleted",
    });
    store.fp_onboarding_drafts.push(
      abandonedDraft({
        photo_blob_key: blobKey({
          scope: "child",
          ownerId: "22222222-2222-4222-8222-222222222222",
          kind: "cover",
          sequence: 1,
        }),
      })
    );

    const summary = await reapOnboardingDrafts(deps);

    expect(deletedKeys).toEqual([]);
    expect(summary.blobs.refused).toBe(1);
    expect(summary.ok).toBe(false);
  });

  it("sweeps a CONSUMED draft's surviving source photo without touching the row otherwise", async () => {
    const { store, deps, deletedKeys } = harness({
      blobConfigured: true,
      deleteBlob: async () => "deleted",
    });
    store.fp_onboarding_drafts.push(
      abandonedDraft({
        status: "consumed",
        child_id: "child-1",
        updated_at: isoAgo(RESIDUAL_PHOTO_MIN_AGE_MS + 1000),
        photo_blob_key: photoKey,
        cover_blob_key: coverKey,
      })
    );

    const summary = await reapOnboardingDrafts(deps);

    // The PHOTO only — a consumed draft's cover key is deliberately out of
    // scope, because if the carry ever failed to copy it, deleting here would
    // erase a live child's cover.
    expect(deletedKeys).toEqual([photoKey]);
    expect(summary.drafts.residualSwept).toBe(1);
    expect(store.fp_onboarding_drafts[0]).toMatchObject({
      status: "consumed",
      photo_blob_key: null,
      cover_blob_key: coverKey,
    });
  });
});

/* ----------------------------------------------------- the orphan backstop */

const orphanAttempt = (over: Record<string, unknown> = {}) => ({
  id: "attempt-orphan",
  parent_email: "alex@example.com",
  parent_id: "parent-1",
  state: "verified",
  child_id: null,
  verification_code_hash: null,
  verification_token_hash: null,
  updated_at: isoAgo(ORPHAN_ATTEMPT_MIN_AGE_MS + DAY),
  ...over,
});

describe("the orphan-attempt backstop (finding 3's guarantee)", () => {
  it("collects an add-kid attempt and its consent when the inline compensation failed", async () => {
    const { store, deps } = harness();
    store.fp_signup_attempts.push(orphanAttempt());
    store.fp_parental_consent.push({
      id: "consent-orphan",
      signup_attempt_id: "attempt-orphan",
      parent_id: "parent-1",
      child_id: null,
    });

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.orphans).toMatchObject({ attemptsSwept: 1, consentSwept: 1 });
    expect(store.fp_signup_attempts).toHaveLength(0);
    expect(store.fp_parental_consent).toHaveLength(0);
  });

  it("never touches an attempt anything real depends on", async () => {
    const { store, deps } = harness();
    store.fp_signup_attempts.push(
      // A parent's step-1 attempt: it keeps its code hash forever.
      orphanAttempt({ id: "a-parent-step", verification_code_hash: "deadbeef" }),
      // A link-door attempt.
      orphanAttempt({ id: "a-link", verification_token_hash: "deadbeef" }),
      // Provisioned.
      orphanAttempt({ id: "a-child", child_id: "child-1" }),
      // Still in the signup path's own machinery.
      orphanAttempt({ id: "a-started", state: "started" }),
      // Too young to be litter.
      orphanAttempt({ id: "a-recent", updated_at: isoAgo(DAY) }),
      // Has a draft.
      orphanAttempt({ id: "a-drafted" }),
      // Its consent is BOUND to a child — a real child exists even though this
      // attempt's own bookkeeping never caught up.
      orphanAttempt({ id: "a-bound-consent" })
    );
    store.fp_onboarding_drafts.push(abandonedDraft({ id: "d-x", signup_attempt_id: "a-drafted" }));
    store.fp_parental_consent.push({
      id: "consent-bound",
      signup_attempt_id: "a-bound-consent",
      child_id: "child-9",
    });

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.orphans.attemptsSwept).toBe(0);
    expect(store.fp_signup_attempts).toHaveLength(7);
    expect(store.fp_parental_consent).toHaveLength(1);
  });

  it("deletes CONSENT FIRST, and keeps the attempt when that delete fails", async () => {
    // `fp_parental_consent.signup_attempt_id` is ON DELETE SET NULL: removing
    // the attempt first would null the only link and leave the evidence
    // permanently unfindable by attempt — the very orphan this collects.
    const { store, deps } = harness({
      faults: { "delete:fp_parental_consent": { kind: "error", error: { message: "down" } } },
    });
    store.fp_signup_attempts.push(orphanAttempt());
    store.fp_parental_consent.push({
      id: "consent-orphan",
      signup_attempt_id: "attempt-orphan",
      child_id: null,
    });

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.ok).toBe(false);
    expect(store.fp_parental_consent).toHaveLength(1);
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(errors.some((e) => e.includes("STRANDED: orphan consent delete failed"))).toBe(true);
  });
});

/* --------------------------------------------------------------- posture */

describe("run posture", () => {
  it("never throws; a read failure is stranded and the OTHER sweep still runs", async () => {
    const { store, deps } = harness({
      faults: {
        // Ordinals 1 and 2 are the two draft-sweep reads. The orphan sweep's
        // draft-link read is the third select on this table and is left healthy
        // — the point of the row is that the backstop still runs.
        "select:fp_onboarding_drafts": {
          kind: "error",
          error: { message: "down" },
          onCalls: [1, 2],
        },
      },
    });
    store.fp_signup_attempts.push(orphanAttempt());

    const summary = await reapOnboardingDrafts(deps);

    expect(summary.ok).toBe(false);
    expect(summary.stranded.some((s) => s.startsWith("drafts:read_"))).toBe(true);
    // The orphan sweep is independently try/caught — a draft-sweep fault must
    // not starve the backstop.
    expect(summary.orphans.attemptsSwept).toBe(1);
  });
});
