import { describe, expect, it, vi } from "vitest";

/**
 * Isolated in its own file: this mock forces `consentVerdict` to return "ok"
 * REGARDLESS of the echoed input, while keeping the REAL currentPolicyHash /
 * FP_CONSENT_POLICY. That is the only way to make the "snapshots server values,
 * not echoed values" claim FALSIFIABLE — in the normal path a verdict is `ok`
 * only when echoed === server, so the two are indistinguishable. With the verdict
 * forced, we can feed DIVERGENT echoed strings and prove the written row carries
 * the server's version/hash, not the client's.
 */
vi.mock("../consent-rules", async (importActual) => {
  const actual = await importActual<typeof import("../consent-rules")>();
  return { ...actual, consentVerdict: () => "ok" as const };
});

import { recordConsent } from "../consent-core";
import { currentPolicyHash, FP_CONSENT_POLICY } from "../consent-rules";

/** Minimal capture fake: a verified attempt read + an insert whose row we keep. */
function captureDb(attempt: Record<string, unknown>) {
  const captured: { row?: Record<string, unknown> } = {};
  function builder(table: string, op?: string, row?: Record<string, unknown>): Record<string, unknown> {
    return {
      select: () => builder(table, op ?? "select", row),
      insert: (r: Record<string, unknown>) => builder(table, "insert", r),
      eq: () => builder(table, op, row),
      maybeSingle: () => Promise.resolve({ data: attempt, error: null }),
      single: () => {
        if (table === "fp_parental_consent" && op === "insert") captured.row = row;
        return Promise.resolve({ data: { id: "consent1" }, error: null });
      },
    };
  }
  return { db: { from: (t: string) => builder(t) } as never, captured };
}

const verifiedAttempt = {
  id: "att1",
  parent_id: "u1",
  parent_email: "dana@example.com",
  state: "verified",
};

describe("recordConsent writes SERVER policy values, not the echoed input", () => {
  it("with the verdict forced ok and DIVERGENT echoed values, the row carries server version/hash", async () => {
    const { db, captured } = captureDb(verifiedAttempt);
    const bogusVersion = "1999-01-01.1";
    const bogusHash = "f".repeat(64);

    const res = await recordConsent(db, {
      attemptId: "att1",
      parentId: "u1",
      echoedVersion: bogusVersion,
      echoedHash: bogusHash,
      method: "email_plus_attestation",
      childAgeBand: "under_13",
      jurisdiction: "US-CA",
      ip: "203.0.113.9",
      ua: "jsdom",
    });
    expect(res.ok).toBe(true);

    const row = captured.row as Record<string, unknown>;
    // The written policy fields are the SERVER's, never the (divergent) echoed input.
    expect(row.policy_version).toBe(FP_CONSENT_POLICY.version);
    expect(row.policy_version).not.toBe(bogusVersion);
    expect(row.policy_hash).toBe(currentPolicyHash());
    expect(row.policy_hash).not.toBe(bogusHash);
    expect(row.rendered_text).toBe(FP_CONSENT_POLICY.text);
    // The divergent echoed values survive ONLY in the evidence blob (as claims).
    expect(row.evidence).toMatchObject({ echoed_version: bogusVersion, echoed_hash: bogusHash });
  });
});
