import { describe, expect, it, vi } from "vitest";

import {
  MAX_PARENT_PASSWORD,
  MIN_PARENT_PASSWORD,
  refundsSetPasswordStrike,
  SET_PASSWORD_OUTCOMES,
  SET_PASSWORD_REFUNDED_OUTCOMES,
  setParentPassword,
  type SetPasswordDeps,
} from "@/app/lib/v3-signup/set-password-core";
import { PASSWORD_CHOSEN_METADATA_KEY } from "@/app/lib/funnel/resume-rules";
import { needsSetPasswordStep } from "@/app/lib/v3-signup/remap-rules";

/**
 * THE ONE-TIME CONVERSION STEP'S CORE (v3 Unit 8 review, FIX 4 + FIX 5a).
 *
 * Extracted from the Server Action for the same reason kid-credentials-core was:
 * the length floor, the refund rule, the eligibility scope and "a failed write
 * is never reported as success" are decisions, and decisions belong somewhere a
 * test can execute them without a Supabase.
 */

const FUNNEL_PENDING = { funnel: true, role: "parent" };

function fakeDeps(
  over: Partial<SetPasswordDeps> & { hasFpChild?: boolean | null; writeOk?: boolean } = {}
) {
  const logs: string[] = [];
  const writes: Array<{ userId: string; password: string; stampKey: string }> = [];
  const fpChildCalls: string[] = [];
  const deps: SetPasswordDeps = {
    familyHasFpChild: async (parentId) => {
      fpChildCalls.push(parentId);
      return over.hasFpChild === undefined ? false : over.hasFpChild;
    },
    setPasswordAndStamp: async (userId, password, stampKey) => {
      writes.push({ userId, password, stampKey });
      return { ok: over.writeOk !== false };
    },
    log: (m) => logs.push(m),
    ...(over.familyHasFpChild ? { familyHasFpChild: over.familyHasFpChild } : {}),
    ...(over.setPasswordAndStamp ? { setPasswordAndStamp: over.setPasswordAndStamp } : {}),
  };
  return { deps, logs, writes, fpChildCalls };
}

const eligible = { userId: "u1", appMetadata: FUNNEL_PENDING };
const good = { password: "x".repeat(MIN_PARENT_PASSWORD) };

/* ─────────────────────────────── the refund set ─────────────────────────────── */

describe("the refunded-strike allowlist (FIX 3)", () => {
  it("is exactly ['outage'], asserted as a WHOLE SET", () => {
    expect([...SET_PASSWORD_REFUNDED_OUTCOMES]).toEqual(["outage"]);
  });

  it("every other outcome keeps its strike by default", () => {
    for (const o of SET_PASSWORD_OUTCOMES) {
      expect(refundsSetPasswordStrike(o), o).toBe(o === "outage");
    }
    expect(SET_PASSWORD_OUTCOMES).toContain("weak_password");
    expect(SET_PASSWORD_OUTCOMES).toContain("not_eligible");
  });
});

/* ──────────────────────────────── the length floor ──────────────────────────────── */

describe("the password bounds", () => {
  it("refuses anything shorter than the floor, and never touches the account", async () => {
    for (let n = 0; n < MIN_PARENT_PASSWORD; n++) {
      const { deps, writes, fpChildCalls } = fakeDeps();
      expect(await setParentPassword(deps, { password: "a".repeat(n) }, eligible), `${n}`).toBe(
        "weak_password"
      );
      expect(writes, `${n}`).toEqual([]);
      // Validation runs BEFORE the eligibility read: a malformed body costs no
      // database round-trip.
      expect(fpChildCalls, `${n}`).toEqual([]);
    }
  });

  it("accepts exactly the floor, and refuses one past the ceiling", async () => {
    const at = fakeDeps();
    expect(
      await setParentPassword(at.deps, { password: "a".repeat(MIN_PARENT_PASSWORD) }, eligible)
    ).toBe("set");
    const over = fakeDeps();
    expect(
      await setParentPassword(over.deps, { password: "a".repeat(MAX_PARENT_PASSWORD + 1) }, eligible)
    ).toBe("weak_password");
    expect(over.writes).toEqual([]);
  });

  it("refuses non-string and missing passwords", async () => {
    for (const bad of [{}, null, { password: 12345678 }, { password: null }, "string"]) {
      const { deps, writes } = fakeDeps();
      expect(await setParentPassword(deps, bad, eligible)).toBe("weak_password");
      expect(writes).toEqual([]);
    }
  });
});

/* ─────────────────────── FIX 4: the eligibility scope ─────────────────────── */

describe("it is scoped to the ONE-TIME conversion, not a change-password endpoint", () => {
  it("sets the password and the stamp in ONE call for the cohort it exists for", async () => {
    const { deps, writes } = fakeDeps();
    expect(await setParentPassword(deps, good, eligible)).toBe("set");
    expect(writes).toEqual([
      { userId: "u1", password: good.password, stampKey: PASSWORD_CHOSEN_METADATA_KEY },
    ]);
  });

  it("REFUSES a parent who has already chosen a password — no silent overwrite", async () => {
    // The action reads the user from the session, so there was never
    // cross-account harm here. The harm was self-inflicted: an already-converted
    // parent calling the endpoint directly would have had their WORKING password
    // replaced by whatever the request carried.
    const { deps, writes, fpChildCalls } = fakeDeps();
    expect(
      await setParentPassword(deps, good, {
        userId: "u1",
        appMetadata: { ...FUNNEL_PENDING, [PASSWORD_CHOSEN_METADATA_KEY]: true },
      })
    ).toBe("not_eligible");
    expect(writes).toEqual([]);
    expect(fpChildCalls).toEqual([]); // settled by metadata alone
  });

  it("REFUSES A BETA-COHORT PARENT — the case `!passwordChosen` alone would have missed", async () => {
    // This cohort is funnel-stamped AND carries no `password_chosen` stamp
    // (they predate it), so the obvious one-line check would have admitted them
    // — and they already chose a real password at verifyCompletion. Their FP
    // children are what say so, which is why the third condition is not
    // optional.
    const { deps, writes } = fakeDeps({ hasFpChild: true });
    expect(await setParentPassword(deps, good, eligible)).toBe("not_eligible");
    expect(writes).toEqual([]);
  });

  it("REFUSES a parent who was never funnel-provisioned", async () => {
    const { deps, writes, fpChildCalls } = fakeDeps();
    expect(
      await setParentPassword(deps, good, { userId: "u1", appMetadata: { role: "parent" } })
    ).toBe("not_eligible");
    expect(writes).toEqual([]);
    expect(fpChildCalls).toEqual([]);
    // ...and null/absent metadata is the same answer, failing closed.
    const bare = fakeDeps();
    expect(await setParentPassword(bare.deps, good, { userId: "u1", appMetadata: null })).toBe(
      "not_eligible"
    );
    expect(bare.writes).toEqual([]);
  });

  it("uses the SAME predicate the remap and the page use — not a weaker echo", async () => {
    // Sweep the whole 2×2×2 truth table and assert the core agrees with
    // `needsSetPasswordStep` on every cell. If the predicate moves, this moves
    // with it; if the core grows its own opinion, this reddens.
    for (const funnelStamped of [true, false]) {
      for (const passwordChosen of [true, false]) {
        for (const hasFpChild of [true, false]) {
          const { deps } = fakeDeps({ hasFpChild });
          const meta: Record<string, unknown> = {};
          if (funnelStamped) meta.funnel = true;
          if (passwordChosen) meta[PASSWORD_CHOSEN_METADATA_KEY] = true;
          const outcome = await setParentPassword(deps, good, { userId: "u1", appMetadata: meta });
          const label = `${funnelStamped}/${passwordChosen}/${hasFpChild}`;
          expect(outcome === "set", label).toBe(
            needsSetPasswordStep({ funnelStamped, passwordChosen, hasFpChild })
          );
        }
      }
    }
  });

  it("an UNREADABLE roster is an outage, never an assumed 'no FP child'", async () => {
    // Reading the failed lookup as "no FP child" would admit exactly the cohort
    // the check protects — fail closed.
    const { deps, writes, logs } = fakeDeps({ hasFpChild: null });
    expect(await setParentPassword(deps, good, eligible)).toBe("outage");
    expect(writes).toEqual([]);
    expect(logs.join(" ")).toContain("fp-child read failed");
  });
});

/* ───────────────────────── the write, and its failure ───────────────────────── */

describe("a failed write is never reported as success", () => {
  it("a failing updateUserById answers `outage`, not `set`", async () => {
    // Reporting success here would navigate the family straight into a sign-in
    // form for a password that was never set — the lockout this whole step
    // exists to prevent.
    const { deps } = fakeDeps({ writeOk: false });
    expect(await setParentPassword(deps, good, eligible)).toBe("outage");
  });

  it("a THROWN write propagates (the action's own try/catch owns it)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("boom"));
    const { deps } = fakeDeps({ setPasswordAndStamp: boom });
    await expect(setParentPassword(deps, good, eligible)).rejects.toThrow("boom");
  });

  it("the target account is the CALLER's — there is no id in the input at all", async () => {
    const { deps, writes } = fakeDeps();
    await setParentPassword(deps, { ...good, userId: "victim", id: "victim" }, eligible);
    expect(writes[0].userId).toBe("u1");
  });
});
