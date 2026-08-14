import { describe, expect, it } from "vitest";

import {
  derivePhotoConsentRateLimitKeys,
  parsePhotoConsentRequest,
  shapePhotoConsentRefusal,
  PHOTO_CONSENT_IP_RATE_LIMIT,
  PHOTO_CONSENT_OK_BODY,
  PHOTO_CONSENT_OK_KEYS,
  PHOTO_CONSENT_RATE_LIMIT,
  PHOTO_CONSENT_READ_TIMEOUT_MS,
  PHOTO_CONSENT_REFUSAL_BODY,
  PHOTO_CONSENT_STALE_BODY,
  PHOTO_CONSENT_STALE_KEYS,
  PHOTO_CONSENT_TOTAL_BUDGET_MS,
  type PhotoConsentRefusalReason,
} from "../photo-consent-rules";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "@/app/api/fp/parent-login/parent-login-rules";
import {
  ageBandFromGrade,
  AGE_BAND_WHEN_UNKNOWN,
} from "@/app/api/fp/grade/grade-rules";
import { ageBandFor } from "@/app/dashboard/KidCredentials";

/**
 * Pure coverage for the photo-permission door's decisions.
 *
 * The one test here that is not about this door at all is the LAST describe:
 * `ageBandFor`'s own docblock demands that any second writer of
 * `fp_parental_consent.child_age_band` agree with it "for EVERY grade — not
 * roughly, exactly", and names a cross-importing test as the way to pin it.
 * This door IS that second writer.
 */

describe("parsePhotoConsentRequest — strict, and discriminated on `action`", () => {
  it("accepts the two documented shapes and nothing else", () => {
    expect(parsePhotoConsentRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", action: "withdraw" })).toEqual({
      ok: true,
      action: "withdraw",
      childId: "ccccccc1-0000-4000-8000-000000000001",
    });
    expect(
      parsePhotoConsentRequest({
        childId: "ccccccc1-0000-4000-8000-000000000001",
        action: "grant",
        consentVersion: "2026-08-08.1",
        consentHash: "a".repeat(64),
      })
    ).toEqual({
      ok: true,
      action: "grant",
      childId: "ccccccc1-0000-4000-8000-000000000001",
      consentVersion: "2026-08-08.1",
      consentHash: "a".repeat(64),
    });
  });

  it("REFUSES a caller-supplied childAgeBand rather than ignoring it", () => {
    // ⚠ THE RULE, NOT A DETAIL. The band is server-derived because
    // `fp_parental_consent` is a legal evidence record and the SPA holds no age
    // for the child. Silently dropping the key would tell a caller "ok" while
    // the server recorded a different band on the very row that says how old
    // this child was — the same reasoning that makes the reset door refuse a
    // caller-supplied password.
    expect(
      parsePhotoConsentRequest({
        childId: "ccccccc1-0000-4000-8000-000000000001",
        action: "grant",
        consentVersion: "v",
        consentHash: "h",
        childAgeBand: "16_plus",
      })
    ).toEqual({ ok: false });
  });

  it("refuses a grant missing its echo, and a withdraw carrying one", () => {
    expect(parsePhotoConsentRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", action: "grant" })).toEqual({ ok: false });
    expect(
      parsePhotoConsentRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", action: "grant", consentVersion: "v" })
    ).toEqual({ ok: false });
    // A withdraw takes nothing but the child: an unknown key is malformed.
    expect(
      parsePhotoConsentRequest({ childId: "ccccccc1-0000-4000-8000-000000000001", action: "withdraw", consentVersion: "v" })
    ).toEqual({ ok: false });
  });

  it("refuses everything else", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "withdraw",
      [],
      {},
      { childId: "ccccccc1-0000-4000-8000-000000000001" },
      { action: "withdraw" },
      { childId: "", action: "withdraw" },
      { childId: 7, action: "withdraw" },
      { childId: "x".repeat(101), action: "withdraw" },
      { childId: "ccccccc1-0000-4000-8000-000000000001", action: "revoke" },
      { childId: "ccccccc1-0000-4000-8000-000000000001", action: "grant", consentVersion: "", consentHash: "h" },
      { childId: "ccccccc1-0000-4000-8000-000000000001", action: "grant", consentVersion: "v", consentHash: "" },
      { childId: "ccccccc1-0000-4000-8000-000000000001", action: "grant", consentVersion: 1, consentHash: "h" },
    ];
    for (const body of bad) {
      expect(parsePhotoConsentRequest(body), JSON.stringify(body ?? null)).toEqual({ ok: false });
    }
  });
});

describe("shapePhotoConsentRefusal — one voice", () => {
  it("is byte-identical for EVERY reason", () => {
    const reasons: PhotoConsentRefusalReason[] = [
      "missing_token",
      "invalid_token",
      "malformed_request",
      "not_parent",
      "rate_limited",
      "core_refused",
      "outage",
    ];
    const shaped = reasons.map((r) => shapePhotoConsentRefusal(r));
    for (const s of shaped) expect(s).toEqual(shaped[0]);
    expect(shaped[0]!.status).toBe(401);
  });

  it("speaks the SAME bytes as parent-login, so no probe of this URL learns anything new", () => {
    expect(PHOTO_CONSENT_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
  });

  it("the stale-policy answer is NOT a refusal shape — that is the whole point", () => {
    // A 200 with an ok:false body: a client (or a proxy, or a log query) that
    // reads status alone can never confuse it with an authorization refusal,
    // and the SPA knows to re-present the current text instead of telling a
    // parent to try again forever.
    expect(JSON.parse(PHOTO_CONSENT_STALE_BODY)).toEqual({ ok: false, reason: "stale_policy" });
    expect(PHOTO_CONSENT_STALE_BODY).not.toBe(PHOTO_CONSENT_REFUSAL_BODY);
  });
});

describe("the wire shapes — twin-pinned key lists", () => {
  it("pins the 200 bodies exactly", () => {
    expect(PHOTO_CONSENT_OK_KEYS).toEqual(["ok"]);
    expect(PHOTO_CONSENT_STALE_KEYS).toEqual(["ok", "reason"]);
    expect(JSON.parse(PHOTO_CONSENT_OK_BODY)).toEqual({ ok: true });
  });
});

describe("rate limiting — its OWN namespaces and budgets", () => {
  it("pins both budgets, so a retune is a deliberate edit", () => {
    expect(PHOTO_CONSENT_RATE_LIMIT).toEqual({ windowMs: 900_000, limit: 20 });
    // The per-IP aggregate is DOUBLE the per-parent one: two parents on one
    // household NAT both fit, a scripted caller does not.
    expect(PHOTO_CONSENT_IP_RATE_LIMIT).toEqual({ windowMs: 900_000, limit: 40 });
  });

  it("namespaces are this door's alone — a spent reset budget must not close this door", () => {
    const { userKey, ipKey } = derivePhotoConsentRateLimitKeys("1.2.3.4", "sub-1", "withdraw");
    expect(userKey.startsWith("fp-parent-photo-consent-withdraw:")).toBe(true);
    expect(ipKey).toBe("fp-parent-photo-consent-withdraw-ip:1.2.3.4");
    expect(userKey).not.toContain("fp-parent-reset");
    expect(userKey).not.toContain("fp-parent-roster");
  });

  it("⚠ GRANT and WITHDRAW do not share a budget", () => {
    // A stale_policy answer keeps its strike (it is a real failed attempt), so
    // a client looping a grant after a policy deploy can spend a whole budget.
    // Shared buckets would then lock the parent out of WITHDRAWING photo
    // permission for fifteen minutes — the direction with the time-critical
    // privacy meaning, and the one a parent must always be able to exercise.
    const grant = derivePhotoConsentRateLimitKeys("1.2.3.4", "sub-1", "grant");
    const withdraw = derivePhotoConsentRateLimitKeys("1.2.3.4", "sub-1", "withdraw");
    expect(grant.userKey).not.toBe(withdraw.userKey);
    expect(grant.ipKey).not.toBe(withdraw.ipKey);
  });

  it("escapes BOTH segments, so two (ip,user) pairs can never alias onto one bucket", () => {
    const a = derivePhotoConsentRateLimitKeys("a:b", "c", "grant").userKey;
    const b = derivePhotoConsentRateLimitKeys("a", "b:c", "grant").userKey;
    expect(a).not.toBe(b);
  });

  it("is TOTAL on a lone surrogate — a throw here would land before either strike", () => {
    expect(() => derivePhotoConsentRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
  });
});

describe("time budgets", () => {
  it("nests one round trip inside the invocation budget, inside maxDuration", () => {
    expect(PHOTO_CONSENT_READ_TIMEOUT_MS).toBeLessThan(PHOTO_CONSENT_TOTAL_BUDGET_MS);
    // 60s is the route's `maxDuration`; the headroom is what guarantees the
    // last word is OUR refusal rather than the platform's CORS-less page.
    expect(PHOTO_CONSENT_TOTAL_BUDGET_MS).toBeLessThan(60_000);
  });
});

describe("⚠ the TWO writers of fp_parental_consent.child_age_band agree, exactly", () => {
  it("matches the dashboard's ageBandFor for EVERY plausible grade", () => {
    // `ageBandFor`'s own docblock: "IF A SECOND WRITER IS EVER ADDED, it must
    // agree with this function for EVERY grade — not roughly, exactly. Two
    // writers of the same NOT NULL column of the same legal-evidence table that
    // disagree mean the band on a child's record depends on which screen the
    // parent happened to consent from." This door is that second writer.
    for (let grade = -5; grade <= 20; grade += 1) {
      expect(ageBandFromGrade(grade) ?? AGE_BAND_WHEN_UNKNOWN, `grade ${grade}`).toBe(
        ageBandFor({ grade } as never)
      );
    }
  });

  it("agrees on every NON-grade too, via the most protective fallback", () => {
    for (const grade of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "" as never]) {
      expect(ageBandFromGrade(grade as never) ?? AGE_BAND_WHEN_UNKNOWN).toBe(
        ageBandFor({ grade } as never)
      );
    }
    // A READER, unlike a writer, is allowed to say "we do not know".
    expect(ageBandFromGrade(null)).toBeNull();
    expect(AGE_BAND_WHEN_UNKNOWN).toBe("under_13");
  });
});
