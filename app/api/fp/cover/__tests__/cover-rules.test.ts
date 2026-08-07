import { describe, expect, it } from "vitest";
import {
  checkCoverOrigin,
  COVER_GENERATION_CAP,
  COVER_REFUSAL_MESSAGE,
  COVER_REFUSAL_STATUS,
  COVER_REFUNDED_REFUSALS,
  COVER_STAGE_LABELS,
  COVER_STAGES,
  decideGenerationCap,
  decideGenerationFeasible,
  decidePhotoAdmission,
  deriveCoverRateLimitKey,
  isCoverAiLive,
  isCoverInfraFailure,
  isPhotoContentType,
  parseCoverRequest,
  resolveCoverMode,
  stagesForMode,
  type CoverRefusalReason,
} from "../cover-rules";
import { V3_COVER_NAMESPACE } from "@/app/lib/fp/rate-limit-rules";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("request parsing", () => {
  it("accepts a bare draft id", () => {
    const p = parseCoverRequest({ draftId: UUID });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.data).toEqual({ draftId: UUID, photoAttempted: false });
  });

  it("RECOGNIZES a photo field rather than silently rejecting it", () => {
    // The distinction matters: a schema rejection would surface as
    // `bad_request`, and the family would never learn that photo covers are
    // simply not switched on.
    const p = parseCoverRequest({ draftId: UUID, photo: "data:image/png;base64,AA" });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.data.photoAttempted).toBe(true);
  });

  it("refuses a non-uuid draft id and any unknown field", () => {
    expect(parseCoverRequest({ draftId: "abc" }).ok).toBe(false);
    expect(parseCoverRequest({ draftId: UUID, sneaky: 1 }).ok).toBe(false);
    expect(parseCoverRequest(null).ok).toBe(false);
    expect(parseCoverRequest("string").ok).toBe(false);
  });

  it("treats multipart and raw image content types as photo attempts", () => {
    expect(isPhotoContentType("multipart/form-data; boundary=x")).toBe(true);
    expect(isPhotoContentType("image/png")).toBe(true);
    expect(isPhotoContentType("MULTIPART/FORM-DATA")).toBe(true);
    expect(isPhotoContentType("application/json")).toBe(false);
    expect(isPhotoContentType(null)).toBe(false);
  });
});

describe("the mode: a flag is not an adapter", () => {
  it("reads COVER_AI_LIVE affirmatively only", () => {
    for (const on of ["1", "true", "TRUE", " on ", "yes"]) expect(isCoverAiLive(on)).toBe(true);
    for (const off of ["", " ", "0", "false", "off", "no", "ture", undefined, null]) {
      expect(isCoverAiLive(off)).toBe(false);
    }
  });

  it("never answers ai without an adapter, no matter what the flag says", () => {
    expect(resolveCoverMode({ aiLive: true, hasVendorAdapter: false })).toBe("template");
    expect(resolveCoverMode({ aiLive: false, hasVendorAdapter: true })).toBe("template");
    expect(resolveCoverMode({ aiLive: true, hasVendorAdapter: true })).toBe("ai");
  });

  it("closes the photo door in template mode and opens it only in ai mode", () => {
    expect(decidePhotoAdmission({ mode: "template", photoAttempted: false })).toEqual({ ok: true });
    expect(decidePhotoAdmission({ mode: "ai", photoAttempted: true })).toEqual({ ok: true });
    const closed = decidePhotoAdmission({ mode: "template", photoAttempted: true });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toBe("photo_closed");
  });
});

describe("the stage model", () => {
  it("gives the template path exactly the two transitions it performs", () => {
    expect(stagesForMode("template")).toEqual(["reserved", "composed"]);
  });

  it("keeps the ai vocabulary a superset that still starts and ends the same way", () => {
    const ai = stagesForMode("ai");
    expect(ai[0]).toBe("reserved");
    expect(ai[ai.length - 1]).toBe("composed");
    for (const stage of stagesForMode("template")) expect(ai).toContain(stage);
  });

  it("has a label for every stage, so the client can never be sent one it cannot render", () => {
    for (const stage of COVER_STAGES) {
      expect(COVER_STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
    expect(Object.keys(COVER_STAGE_LABELS).sort()).toEqual([...COVER_STAGES].sort());
  });
});

describe("the cap", () => {
  it("allows up to the cap and refuses at it", () => {
    for (let n = 0; n < COVER_GENERATION_CAP; n += 1) {
      const v = decideGenerationCap({ generationCount: n });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.next).toBe(n + 1);
    }
    const at = decideGenerationCap({ generationCount: COVER_GENERATION_CAP });
    expect(at.ok).toBe(false);
    if (!at.ok) expect(at.reason).toBe("cap_exhausted");
  });

  it("treats a garbage count as zero rather than as unlimited", () => {
    const v = decideGenerationCap({ generationCount: Number.NaN });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.next).toBe(1);
    // A NEGATIVE count must not buy extra generations either.
    const neg = decideGenerationCap({ generationCount: -5 });
    expect(neg.ok).toBe(true);
    if (neg.ok) expect(neg.next).toBe(1);
  });
});

describe("refusals", () => {
  it("assigns every reason a status and a message", () => {
    const reasons = Object.keys(COVER_REFUSAL_STATUS) as CoverRefusalReason[];
    for (const r of reasons) {
      expect(COVER_REFUSAL_STATUS[r]).toBeGreaterThanOrEqual(400);
      expect(COVER_REFUSAL_MESSAGE[r].length).toBeGreaterThan(0);
    }
    expect(Object.keys(COVER_REFUSAL_MESSAGE).sort()).toEqual(reasons.sort());
  });

  it("releases the rate-limit strike for OUR faults only", () => {
    expect(isCoverInfraFailure("outage")).toBe(true);
    // A refused photo, an exhausted cap and a foreign draft are real attempts.
    for (const r of ["photo_closed", "cap_exhausted", "not_found", "unauthenticated"] as const) {
      expect(isCoverInfraFailure(r)).toBe(false);
    }
  });

  /**
   * ⚠ THE REFUND AUDIT (v3 Unit 4 review, FIX 1). This is a WHOLE-SET assertion
   * on purpose: adding a reason to `CoverRefusalReason` cannot quietly become
   * refundable, and moving one INTO the refunded set turns this red. It is the
   * executable form of the documented rule "audit every rate-limit release
   * against 'would an attacker want this?'"
   * (docs/solutions/security-issues/a-bounded-retry-cas-on-a-security-counter-
   * must-give-up-toward-the-control-and-a-refunded-rate-limit-strike-refunds-
   * the-attacker-2026-08-05.md).
   */
  it("refunds EXACTLY ONE reason — every other refusal keeps its strike", () => {
    const reasons = Object.keys(COVER_REFUSAL_STATUS) as CoverRefusalReason[];
    expect(reasons.filter(isCoverInfraFailure)).toEqual(["outage"]);
    expect([...COVER_REFUNDED_REFUSALS]).toEqual(["outage"]);
  });

  it("does NOT refund `busy` — CAS exhaustion is caller-produced contention", () => {
    // `busy` is reservation-CAS exhaustion on ONE draft row. The only thing that
    // exhausts a bounded CAS budget on one row is sustained concurrent writers,
    // i.e. the caller. Refunding it would let two tabs (or a script) hammer the
    // reservation for free: each attempt still costs an authenticate() round
    // trip, a service-role draft read, up to two consent reads and up to four
    // CAS update+select round trips — and the harder you hammer, the more
    // reliably you are refunded.
    expect(isCoverInfraFailure("busy")).toBe(false);
  });
});

describe("feasibility is decided before anything durable is spent", () => {
  it("refuses a mode this build's phase two cannot perform", () => {
    // The template path is the only one with a generator. An `ai` request is
    // doomed, and saying so in phase one is what keeps it from burning one of
    // COVER_GENERATION_CAP slots and stranding the row on `generating`.
    expect(decideGenerationFeasible("template")).toEqual({ ok: true });
    expect(decideGenerationFeasible("ai")).toEqual({ ok: false, reason: "outage" });
  });
});

describe("origin + rate-limit key", () => {
  it("accepts only an exact same-origin match", () => {
    expect(checkCoverOrigin("https://the120.school", "https://the120.school").ok).toBe(true);
    expect(checkCoverOrigin("https://evil.example", "https://the120.school").ok).toBe(false);
    // A missing Origin is refused: every legitimate caller is a browser POST.
    expect(checkCoverOrigin(null, "https://the120.school").ok).toBe(false);
    expect(checkCoverOrigin("", "https://the120.school").ok).toBe(false);
    // A subdomain is not the origin.
    expect(checkCoverOrigin("https://a.the120.school", "https://the120.school").ok).toBe(false);
  });

  it("derives the bucket from V3_COVER_NAMESPACE, never a re-typed literal", () => {
    // A rename of the namespace constant must move the bucket, not split it in
    // two (v3 Unit 4 review, FIX 8b).
    expect(deriveCoverRateLimitKey("1.2.3.4")).toBe(`${V3_COVER_NAMESPACE}:1.2.3.4`);
  });

  it("encodes the ip segment so IPv6 colons cannot alias two buckets together", () => {
    const a = deriveCoverRateLimitKey("2001:db8");
    const b = deriveCoverRateLimitKey("2001:db8:");
    expect(a).not.toBe(b);
    expect(a).toContain("%3A");
  });
});
