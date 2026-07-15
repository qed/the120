import { describe, expect, it } from "vitest";
import {
  demoteWarning,
  interpretClaimMiss,
  offerButtonState,
  offerEmailTemplate,
  unclaimOutcome,
} from "@/app/crm/lib/offer-rules";
import { sendOfferEmailSchema } from "@/app/crm/lib/reviews-rules";
import { DEPOSIT_REFUND_DEADLINE_LABEL, SITE_URL } from "@/app/lib/site";

/**
 * Offer email rules (plan 2026-07-15-001 Unit 2). Pure functions only —
 * template, button state, demote warning, claim/unclaim interpretation,
 * and the resendOf schema round-trip (CAS string invariant).
 */

const paid = { status: "paid" };
const refunded = { status: "refunded" };

describe("offerEmailTemplate", () => {
  const out = offerEmailTemplate({ childFirstName: "Clay", parentName: "Kevin" });

  it("names the child in BOTH subject and body (F1 — two offered kids must never read as a double-send)", () => {
    expect(out.subject).toContain("Clay");
    expect(out.text).toContain("Clay");
    expect(out.html).toContain("Clay");
  });

  it("greets the parent and links the dashboard via SITE_URL", () => {
    expect(out.text).toContain("Kevin");
    expect(out.text).toContain(`${SITE_URL}/dashboard`);
    expect(out.html).toContain(`${SITE_URL}/dashboard`);
  });

  it("reads the refund deadline from the shared constant in text and html", () => {
    expect(out.text).toContain(DEPOSIT_REFUND_DEADLINE_LABEL);
    expect(out.html).toContain(DEPOSIT_REFUND_DEADLINE_LABEL);
  });

  it("escapes interpolated names in the html part, leaves text raw", () => {
    const evil = offerEmailTemplate({
      childFirstName: '<img src=x onerror="pwn()">',
      parentName: "A & B <script>",
    });
    expect(evil.html).not.toContain("<img");
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;img");
    expect(evil.html).toContain("A &amp; B");
    // Plaintext part carries the raw value — HTML escaping there would
    // render literal entities in plain-text clients.
    expect(evil.text).toContain('<img src=x onerror="pwn()">');
  });

  it("strips CR/LF and truncates names in the subject (header defense, distinct from HTML escaping)", () => {
    const evil = offerEmailTemplate({
      childFirstName: "Clay\r\nBcc: evil@example.com",
      parentName: "Kevin",
    });
    expect(evil.subject).not.toMatch(/[\r\n]/);
    const long = offerEmailTemplate({
      childFirstName: "x".repeat(300),
      parentName: "Kevin",
    });
    expect(long.subject.length).toBeLessThan(200);
  });
});

describe("offerButtonState", () => {
  const base = {
    reviewStatus: "offered",
    deposits: [] as { status: string }[],
    effectiveParentEmail: "kevin@example.com",
    offerSentAt: null as string | null,
  };

  it("offered + unpaid + email + no stamp → sendable", () => {
    expect(offerButtonState(base)).toBe("sendable");
  });

  it("offered + unpaid + email + stamp → resendable", () => {
    expect(offerButtonState({ ...base, offerSentAt: "2026-07-15T10:00:00+00:00" })).toBe(
      "resendable"
    );
  });

  it("member + unpaid → sendable (straight-to-Member family stays reachable)", () => {
    expect(offerButtonState({ ...base, reviewStatus: "member" })).toBe("sendable");
  });

  it("pre-Offered → not_offered, and the gate state WINS over a missing email (precedence)", () => {
    expect(
      offerButtonState({ ...base, reviewStatus: "submitted", effectiveParentEmail: "" })
    ).toBe("not_offered");
  });

  it("paid deposit → deposit_paid, winning over a missing email", () => {
    expect(
      offerButtonState({ ...base, deposits: [paid], effectiveParentEmail: "" })
    ).toBe("deposit_paid");
  });

  it("offered + unpaid + NO email → no_contact (only when otherwise send-eligible)", () => {
    expect(offerButtonState({ ...base, effectiveParentEmail: "  " })).toBe("no_contact");
  });

  it("unknown status fails closed → not_offered (inherited from canReserveSeat)", () => {
    expect(offerButtonState({ ...base, reviewStatus: "OFFERED" })).toBe("not_offered");
  });

  it("refund re-arms: refunded-only deposits → sendable / resendable again", () => {
    expect(offerButtonState({ ...base, deposits: [refunded] })).toBe("sendable");
    expect(
      offerButtonState({
        ...base,
        deposits: [refunded],
        offerSentAt: "2026-07-15T10:00:00+00:00",
      })
    ).toBe("resendable");
  });

  it("badge survival (R9): gate-closed states still carry the stamp — enum drives interactivity only", () => {
    // The sent-date badge is rendered whenever offerSentAt is non-null,
    // independent of the returned state; these two are the disabled states
    // the badge must survive (send → parent pays; send → demoted).
    expect(
      offerButtonState({ ...base, deposits: [paid], offerSentAt: "2026-07-15T10:00:00+00:00" })
    ).toBe("deposit_paid");
    expect(
      offerButtonState({
        ...base,
        reviewStatus: "submitted",
        offerSentAt: "2026-07-15T10:00:00+00:00",
      })
    ).toBe("not_offered");
  });
});

describe("demoteWarning", () => {
  const stamp = "2026-07-15T10:00:00+00:00";

  it("warns moving pre-Offered with a stamp and no paid deposit", () => {
    expect(demoteWarning({ targetStatus: "in_review", offerSentAt: stamp, deposits: [] })).toBe(
      true
    );
    expect(
      demoteWarning({ targetStatus: "submitted", offerSentAt: stamp, deposits: [refunded] })
    ).toBe(true);
  });

  it("never warns without a stamp, with a paid deposit, or moving to offered-or-later", () => {
    expect(demoteWarning({ targetStatus: "in_review", offerSentAt: null, deposits: [] })).toBe(
      false
    );
    expect(
      demoteWarning({ targetStatus: "in_review", offerSentAt: stamp, deposits: [paid] })
    ).toBe(false);
    expect(demoteWarning({ targetStatus: "member", offerSentAt: stamp, deposits: [] })).toBe(
      false
    );
    expect(demoteWarning({ targetStatus: "offered", offerSentAt: stamp, deposits: [] })).toBe(
      false
    );
  });
});

describe("sendOfferEmailSchema (CAS string round-trip)", () => {
  const childId = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";

  it("accepts a bare childId (first send)", () => {
    const r = sendOfferEmailSchema.safeParse({ childId });
    expect(r.success).toBe(true);
  });

  it("accepts the +00:00 offset form PostgREST returns, VERBATIM (no transform)", () => {
    const stamp = "2026-07-15T10:23:45.123+00:00";
    const r = sendOfferEmailSchema.safeParse({ childId, resendOf: stamp });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.resendOf).toBe(stamp);
  });

  it("accepts the Z form too", () => {
    const r = sendOfferEmailSchema.safeParse({
      childId,
      resendOf: "2026-07-15T10:23:45.123Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects garbage", () => {
    expect(sendOfferEmailSchema.safeParse({ childId: "nope" }).success).toBe(false);
    expect(
      sendOfferEmailSchema.safeParse({ childId, resendOf: "yesterday" }).success
    ).toBe(false);
  });
});

describe("interpretClaimMiss (zero rows claimed — probe child_reviews, not children)", () => {
  it("stamp set → already_sent with the fresh stamp for re-CAS", () => {
    expect(interpretClaimMiss({ exists: true, stamp: "2026-07-15T10:00:00+00:00" })).toEqual({
      status: "already_sent",
      freshStamp: "2026-07-15T10:00:00+00:00",
    });
  });

  it("review row missing → not_found", () => {
    expect(interpretClaimMiss({ exists: false, stamp: null })).toEqual({
      status: "not_found",
    });
  });

  it("row present, stamp null (claim raced an unclaim) → gate_closed so the client refreshes to truth", () => {
    expect(interpretClaimMiss({ exists: true, stamp: null })).toEqual({
      status: "gate_closed",
    });
  });
});

describe("unclaimOutcome (CAS-guarded restore after a failed send)", () => {
  it("restore took → restored (plain send_failed, no warning)", () => {
    expect(unclaimOutcome({ errored: false, restoredRows: 1 })).toBe("restored");
  });

  it("zero rows restored → superseded by a concurrent claim (no restore, NO warning — newer stamp is truth)", () => {
    expect(unclaimOutcome({ errored: false, restoredRows: 0 })).toBe("superseded");
  });

  it("restore errored on a genuinely-held claim → warn", () => {
    expect(unclaimOutcome({ errored: true, restoredRows: 0 })).toBe("warn");
  });
});
