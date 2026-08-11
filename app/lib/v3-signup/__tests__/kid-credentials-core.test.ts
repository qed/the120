import { describe, expect, it } from "vitest";

import {
  captureLegacyChildConsent,
  PHOTO_WITHDRAWAL_REASON,
  resetKidPassword,
  revokeChildPhotoConsent,
  type KidCredentialsDeps,
} from "@/app/lib/v3-signup/kid-credentials-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
  photoConsentVerdict,
} from "@/app/api/fp/signup/consent-rules";

/**
 * The dashboard's credentials-recovery + legacy-consent cores, by EXECUTION
 * against a tiny PostgREST-lite fake.
 *
 * AUTHORIZATION IS THE THEME, so most of this file asserts NEGATIVES: what the
 * cores must never read, never write, and never call. The fake records every
 * filter it is handed, which is how "the parent id was in the WHERE clause"
 * becomes an assertion rather than a code-reading exercise.
 */

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const PARENT = "parent-1";
const OTHER_PARENT = "parent-2";

type Row = Record<string, unknown>;

/** A query the fake saw: the table plus every filter, in order. */
type Seen = { table: string; op: string; filters: string[] };

function fakeDb(tables: Record<string, Row[]>) {
  const seen: Seen[] = [];
  const failing = new Set<string>();

  const builder = (table: string, op: string, patch?: Row) => {
    const filters: string[] = [];
    const record: Seen = { table, op, filters };
    seen.push(record);
    const eqs: Array<[string, unknown]> = [];
    const isNulls: string[] = [];
    const notNulls: string[] = [];

    const match = (r: Row) =>
      eqs.every(([k, v]) => String(r[k] ?? "") === String(v)) &&
      isNulls.every((k) => r[k] == null) &&
      notNulls.every((k) => r[k] != null);

    const run = () => {
      if (failing.has(`${table}:${op}`)) {
        return { data: null, error: { message: `${table} ${op} failed` } };
      }
      const rows = tables[table] ?? [];
      const hits = rows.filter(match);
      if (op === "update") for (const r of hits) Object.assign(r, patch);
      if (op === "insert") {
        rows.push({ id: `row-${rows.length + 1}`, ...(patch ?? {}) });
        return { data: [patch], error: null };
      }
      return { data: hits.map((r) => ({ ...r })), error: null };
    };

    const api = {
      eq(col: string, val: unknown) {
        filters.push(`eq:${col}=${String(val)}`);
        eqs.push([col, val]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push(`is:${col}=${String(val)}`);
        if (val === null) isNulls.push(col);
        return api;
      },
      not(col: string, op2: string, val: unknown) {
        filters.push(`not:${col}.${op2}=${String(val)}`);
        if (op2 === "is" && val === null) notNulls.push(col);
        return api;
      },
      select() {
        return api;
      },
      maybeSingle() {
        const res = run();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        return Promise.resolve({ data: (res.data as Row[])[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return api;
  };

  const db = {
    from(table: string) {
      return {
        select: () => builder(table, "select").select(),
        update: (patch: Row) => builder(table, "update", patch),
        insert: (patch: Row) => builder(table, "insert", patch),
      };
    },
  };
  return { db, seen, failing };
}

function makeDeps(tables: Record<string, Row[]>) {
  const { db, seen, failing } = fakeDb(tables);
  const passwordCalls: Array<{ userId: string; password: string }> = [];
  let dbConstructions = 0;
  const deps: KidCredentialsDeps = {
    db: () => {
      dbConstructions += 1;
      return db as never;
    },
    setUserPassword: async (userId, password) => {
      passwordCalls.push({ userId, password });
      return { ok: true };
    },
    now: () => NOW,
    log: () => {},
  };
  return { deps, seen, failing, passwordCalls, dbConstructions: () => dbConstructions };
}

const fpChild = (over: Row = {}): Row => ({
  id: "kid-1",
  parent_id: PARENT,
  first_name: "Remi",
  last_name: "Newal",
  fp_username: "remi.newal",
  photo_consent_revoked_at: null,
  ...over,
});

const GOOD_PASSWORD = "orangeledgerkite";

/* ───────────────────────────── the reset ───────────────────────────── */

describe("resetKidPassword — authorization first, and it is a WHERE clause", () => {
  it("sets the password on the child's own auth user (happy path)", async () => {
    const { deps, passwordCalls } = makeDeps({
      children: [fpChild()],
      path_student_profiles: [{ child_id: "kid-1", user_id: "auth-kid-1" }],
    });
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: GOOD_PASSWORD }, { parentId: PARENT })
    ).resolves.toBe("reset");
    expect(passwordCalls).toEqual([{ userId: "auth-kid-1", password: GOOD_PASSWORD }]);
  });

  it("REFUSES a child the caller does not own, and never touches a credential", async () => {
    const { deps, seen, passwordCalls } = makeDeps({
      children: [fpChild({ parent_id: OTHER_PARENT })],
      path_student_profiles: [{ child_id: "kid-1", user_id: "auth-kid-1" }],
    });
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: GOOD_PASSWORD }, { parentId: PARENT })
    ).resolves.toBe("not_owned");
    expect(passwordCalls).toEqual([]);
    // The ownership proof is a PREDICATE, not a fetched-row comparison: the
    // caller's parent id went into the query, so no row came back to mis-check.
    expect(seen[0].filters).toContain(`eq:parent_id=${PARENT}`);
    // And the profile lookup never ran — nothing downstream of the refusal did.
    expect(seen.some((s) => s.table === "path_student_profiles")).toBe(false);
  });

  it("REFUSES a child with no First Profit account (a v2 applicant kid)", async () => {
    const { deps, seen, passwordCalls } = makeDeps({
      children: [fpChild({ fp_username: null })],
      path_student_profiles: [],
    });
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: GOOD_PASSWORD }, { parentId: PARENT })
    ).resolves.toBe("not_owned");
    expect(passwordCalls).toEqual([]);
    // `fp_username IS NOT NULL` rides in the WHERE too — same mechanism.
    expect(seen[0].filters).toContain("not:fp_username.is=null");
  });

  it("refuses a malformed body BEFORE any privileged client is constructed", async () => {
    const { deps, dbConstructions } = makeDeps({ children: [fpChild()] });
    await expect(resetKidPassword(deps, null, { parentId: PARENT })).resolves.toBe("bad_request");
    await expect(
      resetKidPassword(deps, { childId: "kid-1" }, { parentId: PARENT })
    ).resolves.toBe("bad_request");
    expect(dbConstructions()).toBe(0);
  });

  it("runs validateStudentPassword against the child's REAL name, read from the authorized row", async () => {
    const { deps, passwordCalls } = makeDeps({
      children: [fpChild()],
      path_student_profiles: [{ child_id: "kid-1", user_id: "auth-kid-1" }],
    });
    // "remi" is the child's first name — the name-overlap rule must bite even
    // though the caller never told us the name.
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: "remiremiremi9" }, { parentId: PARENT })
    ).resolves.toBe("weak_password");
    // The parse floor is length-only (non-empty, <= 200); the REAL rules —
    // minimum length, distinct characters, denylist, name overlap — all belong
    // to `validateStudentPassword` and run after the child's name is known.
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: "short" }, { parentId: PARENT })
    ).resolves.toBe("weak_password");
    expect(passwordCalls).toEqual([]);
  });

  it("a child with an fp_username but no student profile is `no_fp_account`, never a silent success", async () => {
    const { deps, passwordCalls } = makeDeps({
      children: [fpChild()],
      path_student_profiles: [],
    });
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: GOOD_PASSWORD }, { parentId: PARENT })
    ).resolves.toBe("no_fp_account");
    expect(passwordCalls).toEqual([]);
  });

  it("a failed children read is an outage, not a refusal (they may well own the child)", async () => {
    const { deps, failing } = makeDeps({ children: [fpChild()] });
    failing.add("children:select");
    await expect(
      resetKidPassword(deps, { childId: "kid-1", password: GOOD_PASSWORD }, { parentId: PARENT })
    ).resolves.toBe("outage");
  });
});

/* ──────────────────────── the legacy consent variant ──────────────────────── */

const echo = () => ({
  echoedVersion: FP_CONSENT_POLICY.version,
  echoedHash: currentPolicyHash(),
});

describe("captureLegacyChildConsent — child-bound, attempt-less, bind-to-rendered", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    childId: "kid-1",
    ...echo(),
    childAgeBand: "under_13" as const,
    parentEmail: "p@example.com",
    ip: "1.2.3.4",
    ua: "test",
    ...over,
  });

  it("writes a consent row bound to the CHILD with a NULL signup_attempt_id", async () => {
    const consents: Row[] = [];
    const { deps } = makeDeps({ children: [fpChild()], fp_parental_consent: consents });
    await expect(
      captureLegacyChildConsent(deps, input(), { parentId: PARENT })
    ).resolves.toBe("recorded");
    expect(consents).toHaveLength(1);
    // The whole reason this is a separate variant: `recordConsent` requires a
    // `verified` attempt, and a pre-v3 family has none. Minting a synthetic one
    // would forge the evidence that check protects.
    expect(consents[0].signup_attempt_id).toBeNull();
    expect(consents[0].child_id).toBe("kid-1");
    // The record snapshots the SERVER's text/version, never the echoed strings.
    expect(consents[0].policy_version).toBe(FP_CONSENT_POLICY.version);
    expect(consents[0].rendered_text).toBe(FP_CONSENT_POLICY.text);
    // Server-derived identity, never the request body.
    expect(consents[0].parent_identity).toEqual({ email: "p@example.com" });
  });

  it("REFUSES a child the caller does not own, and writes nothing", async () => {
    const consents: Row[] = [];
    const { deps } = makeDeps({
      children: [fpChild({ parent_id: OTHER_PARENT })],
      fp_parental_consent: consents,
    });
    await expect(
      captureLegacyChildConsent(deps, input(), { parentId: PARENT })
    ).resolves.toBe("not_owned");
    expect(consents).toEqual([]);
  });

  it("refuses a STALE echo before it reads anything at all", async () => {
    const { deps, dbConstructions } = makeDeps({ children: [fpChild()], fp_parental_consent: [] });
    await expect(
      captureLegacyChildConsent(deps, input({ echoedVersion: "2026-08-01.1" }), {
        parentId: PARENT,
      })
    ).resolves.toBe("stale_policy");
    expect(dbConstructions()).toBe(0);
  });

  it("refuses a TAMPERED hash (right version, wrong text)", async () => {
    const { deps } = makeDeps({ children: [fpChild()], fp_parental_consent: [] });
    await expect(
      captureLegacyChildConsent(deps, input({ echoedHash: "0".repeat(64) }), {
        parentId: PARENT,
      })
    ).resolves.toBe("stale_policy");
  });

  it("DUPLICATE capture is harmless by construction — plural rows open the same gate", async () => {
    const consents: Row[] = [];
    const { deps } = makeDeps({ children: [fpChild()], fp_parental_consent: consents });
    await captureLegacyChildConsent(deps, input(), { parentId: PARENT });
    await captureLegacyChildConsent(deps, input(), { parentId: PARENT });
    expect(consents).toHaveLength(2);
    // Attempt-less rows escape the partial unique index, which is exactly why
    // the photo gate is an EXISTS: two identical affirmations mean one open gate.
    const verdict = photoConsentVerdict({
      rows: consents.map((c) => ({
        policyVersion: String(c.policy_version),
        acceptedAt: String(c.accepted_at),
        revokedAt: null,
      })),
      revokedAt: null,
    });
    expect(verdict.ok).toBe(true);
  });
});

/* ───────────────────────────── revocation ───────────────────────────── */

describe("revokeChildPhotoConsent — PURPOSE-SCOPED: tombstone + photo mark, never a revocation", () => {
  const activeRows = () => [
    { id: "c1", child_id: "kid-1", parent_id: PARENT, policy_version: FP_CONSENT_POLICY.version, accepted_at: "2026-08-05T11:00:00.000Z", revoked_at: null, evidence: { source: "signup" } },
    { id: "c2", child_id: "kid-1", parent_id: PARENT, policy_version: FP_CONSENT_POLICY.version, accepted_at: "2026-08-05T11:30:00.000Z", revoked_at: null, evidence: { source: "signup" } },
    { id: "c3", child_id: "kid-9", parent_id: PARENT, policy_version: FP_CONSENT_POLICY.version, accepted_at: "2026-08-05T11:30:00.000Z", revoked_at: null, evidence: { source: "signup" } },
  ];

  const asPhotoRows = (consents: Row[], childId: string) =>
    consents
      .filter((c) => c.child_id === childId)
      .map((c) => ({
        policyVersion: c.policy_version as string,
        acceptedAt: c.accepted_at as string,
        revokedAt: c.revoked_at as string | null,
        evidence: c.evidence,
      }));

  it("marks every active row for THIS child, leaves other children alone, and closes the gate", async () => {
    const consents = activeRows();
    const children = [fpChild(), fpChild({ id: "kid-9" })];
    const { deps } = makeDeps({ children, fp_parental_consent: consents });

    await expect(
      revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT })
    ).resolves.toBe("revoked");

    const stamp = new Date(NOW).toISOString();
    for (const c of consents.filter((c) => c.child_id === "kid-1")) {
      expect(c.evidence).toMatchObject({
        photo_declined: true,
        photo_withdrawn_at: stamp,
        withdrawal_reason: PHOTO_WITHDRAWAL_REASON,
        // READ-MODIFY-WRITE: the key that was already there survives.
        source: "signup",
      });
    }
    // A sibling's consent is untouched, in every respect.
    expect(consents.find((c) => c.child_id === "kid-9")!.evidence).toEqual({ source: "signup" });
    expect(consents.find((c) => c.child_id === "kid-9")!.revoked_at).toBeNull();
    // And the tombstone landed.
    const tomb = children[0].photo_consent_revoked_at as string;
    expect(tomb).toBe(stamp);

    // THE OBSERVABLE THAT MATTERS: the shared pure gate now refuses.
    const verdict = photoConsentVerdict({
      rows: asPhotoRows(consents, "kid-1"),
      revokedAt: tomb,
    });
    expect(verdict.ok).toBe(false);
  });

  it("⚠ DOES NOT RE-ARM THE CONSENT WALL — the row is a general consent, not a photo permission (review P1-a)", async () => {
    // THE BUG. This used to stamp `revoked_at` on every active row, which is the
    // family's ONE general parental consent — to the account existing at all.
    // The wall clears a child on ANY active row at/after the anchor, so a photo
    // withdrawal bounced the whole family back to /consent and made every gated
    // action refuse them. A parent who withdraws photo permission has withdrawn
    // photo permission.
    const consents = activeRows();
    const children = [fpChild()];
    const { deps } = makeDeps({ children, fp_parental_consent: consents });

    await expect(
      revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT })
    ).resolves.toBe("revoked");

    // 1. THE GENERAL CONSENT SURVIVES. Not one row was revoked. This is the
    //    load-bearing half: that row is the family's ONE general parental
    //    consent (account, storage, public site) with photo as a single
    //    purpose inside it. Revoking it wholesale — which is what this code
    //    used to do — retro-invalidated `consentGate` inside `createChild`,
    //    so a parent who withdrew photo permission silently lost the ability
    //    to add another kid.
    const stillActive = consents
      .filter((c) => c.child_id === "kid-1" && c.revoked_at == null)
      .map((c) => String(c.policy_version));
    expect(stillActive.length).toBe(2);

    // 2. AND THE PHOTO PERMISSION IS GENUINELY GONE — both ways, independently.
    const tomb = children[0].photo_consent_revoked_at as string;
    expect(tomb).toBe(new Date(NOW).toISOString());
    //    a) the tombstone alone closes it (strictly-after filter)
    expect(photoConsentVerdict({ rows: asPhotoRows(consents, "kid-1"), revokedAt: tomb }))
      .toMatchObject({ ok: false, reason: "pre_tombstone" });
    //    b) and so does the evidence mark, with the tombstone taken away —
    //       which is what keeps the closure true if a later row post-dates it.
    expect(photoConsentVerdict({ rows: asPhotoRows(consents, "kid-1"), revokedAt: null }))
      .toMatchObject({ ok: false, reason: "declined" });
  });

  it("the TOMBSTONE is written FIRST, so a capture racing the mark cannot re-open the gate", async () => {
    const consents = activeRows();
    const children = [fpChild()];
    const { deps, seen } = makeDeps({ children, fp_parental_consent: consents });
    await revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT });

    const tombIdx = seen.findIndex((s) => s.table === "children" && s.op === "update");
    const sweepIdx = seen.findIndex((s) => s.table === "fp_parental_consent" && s.op === "update");
    expect(tombIdx).toBeGreaterThanOrEqual(0);
    expect(tombIdx).toBeLessThan(sweepIdx);

    // The consequence, asserted rather than described: a row the sweep could
    // not see, inserted at the same instant, still loses — the gate's tombstone
    // check is strictly-after.
    const racing = {
      policyVersion: FP_CONSENT_POLICY.version,
      acceptedAt: new Date(NOW).toISOString(),
      revokedAt: null,
    };
    expect(
      photoConsentVerdict({ rows: [racing], revokedAt: new Date(NOW).toISOString() }).ok
    ).toBe(false);
  });

  it("REFUSES a child the caller does not own — no tombstone, no mark", async () => {
    const consents = activeRows();
    const children = [fpChild({ parent_id: OTHER_PARENT })];
    const { deps } = makeDeps({ children, fp_parental_consent: consents });
    await expect(
      revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT })
    ).resolves.toBe("not_owned");
    expect(children[0].photo_consent_revoked_at).toBeNull();
    expect(consents.every((c) => c.revoked_at === null)).toBe(true);
    expect(consents.every((c) => (c.evidence as Record<string, unknown>).photo_declined === undefined)).toBe(true);
  });

  it("NEVER writes revoked_at — the one writer of that column is the wall's dedupe sweep (review P1-b)", async () => {
    const consents = activeRows();
    const { deps } = makeDeps({ children: [fpChild()], fp_parental_consent: consents });
    await revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT });
    expect(consents.every((c) => c.revoked_at === null)).toBe(true);
  });

  it("a failed evidence write reports `outage`, but the tombstone has already closed the gate", async () => {
    const consents = activeRows();
    const children = [fpChild()];
    const { deps, failing } = makeDeps({ children, fp_parental_consent: consents });
    failing.add("fp_parental_consent:update");
    await expect(
      revokeChildPhotoConsent(deps, { childId: "kid-1" }, { parentId: PARENT })
    ).resolves.toBe("outage");
    expect(children[0].photo_consent_revoked_at).toBe(new Date(NOW).toISOString());
    expect(
      photoConsentVerdict({
        rows: asPhotoRows(consents, "kid-1"),
        revokedAt: children[0].photo_consent_revoked_at as string,
      }).ok
    ).toBe(false);
  });

  it("a later, deliberate re-capture post-dates the tombstone and re-opens the gate", async () => {
    // Revocation CLOSES the gate; it does not brick it.
    const later = {
      policyVersion: FP_CONSENT_POLICY.version,
      acceptedAt: new Date(NOW + 60_000).toISOString(),
      revokedAt: null,
    };
    expect(
      photoConsentVerdict({ rows: [later], revokedAt: new Date(NOW).toISOString() }).ok
    ).toBe(true);
  });
});
