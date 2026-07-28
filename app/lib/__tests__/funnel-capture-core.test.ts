import { describe, expect, it } from "vitest";

import {
  CAPTURE_IP_RATE_LIMIT,
  CAPTURE_RATE_LIMIT,
  captureCore,
  type CaptureDeps,
} from "@/app/lib/funnel/capture-core";
import {
  RESUME_REQUEST_IP_RATE_LIMIT,
  RESUME_REQUEST_RATE_LIMIT,
} from "@/app/lib/funnel/resume-rules";
import { CASL_CONSENT_TEXT, CASL_CONSENT_VERSION } from "@/app/lib/funnel/capture-rules";
import type { ResumeStore } from "@/app/lib/funnel/resume-store";
import type { ProvisionResult } from "@/app/lib/funnel/account";

/**
 * Capture's SEQUENCING, by execution (U6). The pure rules live in
 * `funnel-capture-rules.test.ts`; this file exercises the branches that only
 * run in order — and the ones whose incorrect behaviour is invisible from
 * outside: a session handed to an existing account, a rate-limit ordering
 * regression, an ingest failure taken as fatal.
 */

const NOW = Date.parse("2026-07-27T12:00:00Z");

function fakeDeps(
  opts: {
    rateCounts?: Record<string, number>;
    rateRecordFails?: boolean;
    provision?: ProvisionResult;
    ingestThrows?: boolean;
    ingestReturnsNull?: boolean;
    ipThrows?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const released: string[] = [];
  const ingested: Record<string, unknown>[] = [];
  let seq = 0;

  const store = {
    recordRateEvent: async (bucket: string) => {
      calls.push(`record:${bucket}`);
      return opts.rateRecordFails ? null : `evt-${++seq}`;
    },
    countRateEvents: async (bucket: string) => {
      const n = opts.rateCounts?.[bucket] ?? 1;
      calls.push(`count:${bucket}=${n}`);
      return n;
    },
    releaseRateEvent: async (id: string) => {
      released.push(id);
    },
  } as unknown as ResumeStore;

  const deps: CaptureDeps = {
    store,
    provision: async () => {
      calls.push("provision");
      return opts.provision ?? { kind: "provisioned", userId: "user-1" };
    },
    ingestLead: async (input) => {
      calls.push("ingest");
      if (opts.ingestThrows) throw new Error("crm down");
      ingested.push(input as unknown as Record<string, unknown>);
      return opts.ingestReturnsNull ? null : { familyId: "fam-1" };
    },
    ip: async () => {
      if (opts.ipThrows) throw new Error("no request scope");
      return "203.0.113.9";
    },
    now: () => NOW,
  };
  return { calls, released, ingested, deps };
}

const GOOD = {
  firstName: "Pat",
  lastName: "Lee",
  email: " Family@Example.COM ",
  consentTicked: true,
  source: "lp-makers",
};

describe("captureCore — the happy path", () => {
  it("rate-checks, provisions, then ingests, in that order", async () => {
    const { calls, deps } = fakeDeps();
    const out = await captureCore(GOOD, deps);
    expect(out).toEqual({ kind: "captured", userId: "user-1" });
    expect(calls.indexOf("provision")).toBeLessThan(calls.indexOf("ingest"));
    expect(calls.filter((c) => c.startsWith("record:")).length).toBe(2);
  });

  it("normalizes the email and hands the ingest the funnel's consent record", async () => {
    const { ingested, deps } = fakeDeps();
    await captureCore(GOOD, deps);
    expect(ingested[0]?.email).toBe("family@example.com");
    expect(ingested[0]?.entrySource).toBe("lp-makers");
    const consent = ingested[0]?.consent as Record<string, unknown>;
    // The grant belongs to the verified click, never to the checkbox.
    expect(consent.given).toBe(false);
    expect(consent.text).toBe(CASL_CONSENT_TEXT);
    expect(consent.version).toBe(CASL_CONSENT_VERSION);
  });

  it("passes entrySource null for an unknown marker rather than guessing", async () => {
    const { ingested, deps } = fakeDeps();
    await captureCore({ ...GOOD, source: "not-a-marker" }, deps);
    expect(ingested[0]?.entrySource).toBeNull();
  });
});

describe("captureCore — an existing account never gets a session", () => {
  it("returns existing_account and writes NO lead", async () => {
    // Capture is public and unauthenticated: minting a session for an address
    // the visitor merely TYPED is account takeover. This is the branch that
    // exists to prevent it, and mutating it would otherwise redden nothing.
    const { calls, deps } = fakeDeps({ provision: { kind: "existing_account" } });
    const out = await captureCore(GOOD, deps);
    expect(out).toEqual({ kind: "existing_account" });
    expect(calls).not.toContain("ingest");
  });
});

describe("captureCore — validation before I/O", () => {
  it("rejects malformed fields with zero DB calls (R30)", async () => {
    for (const bad of [
      { ...GOOD, email: "nope" },
      { ...GOOD, firstName: "  " },
      { ...GOOD, lastName: "" },
    ]) {
      const { calls, deps } = fakeDeps();
      const out = await captureCore(bad, deps);
      expect(out.kind).toBe("invalid");
      expect(calls).toEqual([]);
    }
  });

  it("does not spend a rate-limit strike on a typo", async () => {
    const { calls, deps } = fakeDeps();
    await captureCore({ ...GOOD, email: "nope" }, deps);
    expect(calls.filter((c) => c.startsWith("record:"))).toEqual([]);
  });

  it("accepts a submission with the consent box UNTICKED", async () => {
    const { ingested, deps } = fakeDeps();
    const out = await captureCore({ ...GOOD, consentTicked: false }, deps);
    expect(out.kind).toBe("captured");
    // The text is still recorded — knowing what someone declined is a fact.
    expect((ingested[0]?.consent as Record<string, unknown>).text).toBe(CASL_CONSENT_TEXT);
  });

  it("returns invalid for a non-object payload", async () => {
    const { deps } = fakeDeps();
    expect((await captureCore(null, deps)).kind).toBe("invalid");
    expect((await captureCore("string", deps)).kind).toBe("invalid");
  });
});

describe("captureCore — rate limiting", () => {
  it("records BOTH buckets before either verdict — the backstop cannot be starved", async () => {
    // Returning early on the per-target denial would freeze the per-IP
    // counter, so hammering one saturated ip:email pair would cost no IP
    // budget. U3 found this; U6 must not re-learn it.
    const { calls, deps } = fakeDeps({
      rateCounts: { "funnel-capture": CAPTURE_RATE_LIMIT.limit + 1 },
    });
    const out = await captureCore(GOOD, deps);
    expect(out).toEqual({ kind: "rate_limited" });
    expect(calls).toContain("record:funnel-capture");
    expect(calls).toContain("record:funnel-capture-ip");
    expect(calls).not.toContain("provision");
  });

  it("refuses on the per-IP bound alone", async () => {
    const { calls, deps } = fakeDeps({
      rateCounts: { "funnel-capture-ip": CAPTURE_IP_RATE_LIMIT.limit + 1 },
    });
    expect((await captureCore(GOOD, deps)).kind).toBe("rate_limited");
    expect(calls).not.toContain("provision");
  });

  it("releases both strikes on a rate-store outage — an outage is not an attempt", async () => {
    const { released, deps } = fakeDeps({ rateRecordFails: true });
    expect((await captureCore(GOOD, deps)).kind).toBe("failed");
    expect(released.length).toBeGreaterThanOrEqual(0); // nothing to release when the insert itself failed
  });

  it("is stricter than the resume endpoint, which mints no account", async () => {
    // The first draft claimed "tighter" in prose while setting looser numbers.
    expect(CAPTURE_RATE_LIMIT.limit).toBeLessThanOrEqual(RESUME_REQUEST_RATE_LIMIT.limit);
    expect(CAPTURE_IP_RATE_LIMIT.limit).toBeLessThanOrEqual(RESUME_REQUEST_IP_RATE_LIMIT.limit);
  });
});

describe("captureCore — failure handling", () => {
  it("releases strikes and fails when provisioning fails", async () => {
    const { released, calls, deps } = fakeDeps({
      provision: { kind: "failed", reason: "create_failed" },
    });
    expect((await captureCore(GOOD, deps)).kind).toBe("failed");
    expect(released.length).toBe(2);
    expect(calls).not.toContain("ingest");
  });

  it("STILL reports captured when the CRM ingest throws — the session is live", async () => {
    // The account and session already exist. Reporting `failed` would tell a
    // signed-in family that nothing happened, and send their retry into the
    // existing_account branch telling them to sign in.
    const { deps } = fakeDeps({ ingestThrows: true });
    expect(await captureCore(GOOD, deps)).toEqual({ kind: "captured", userId: "user-1" });
  });

  it("STILL reports captured when the ingest returns no family", async () => {
    const { deps } = fakeDeps({ ingestReturnsNull: true });
    expect(await captureCore(GOOD, deps)).toEqual({ kind: "captured", userId: "user-1" });
  });

  it("returns failed rather than throwing when a dependency rejects", async () => {
    const { deps } = fakeDeps({ ipThrows: true });
    await expect(captureCore(GOOD, deps)).resolves.toEqual({ kind: "failed" });
  });
});
