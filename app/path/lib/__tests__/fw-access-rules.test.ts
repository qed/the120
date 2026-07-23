import { describe, expect, it } from "vitest";

import type { RoleGrant } from "../access-rules";
import {
  buildFwGuideCreateUserPayload,
  fwClaimStrikeDisposition,
  fwGuideInviteExpiry,
  fwGuideInviteVerdict,
  isFwStaffActor,
  isGuideAccount,
  resolveFwActor,
  FW_COHORT_KIND,
  FW_GUIDE_INVITE_TTL_MS,
  FW_GUIDE_ROLE,
} from "../fw-access-rules";
import { PARENT_INVITE_TTL_MS } from "../onboarding-rules";

/**
 * The FW authorization decision table (FW Unit 2; FW-R1–R5, FW-D3, FW-D9,
 * Decision 12).
 *
 * This is the module that decides who may write a cascade-free, no-gating
 * check-in onto a child's record, so every branch is exercised — including the
 * ones that exist only because a plausible-looking alternative would be a live
 * event bug.
 */

const SESSION = { user: { id: "user-guide" } };
const BOSTON = { id: "cohort-boston", kind: FW_COHORT_KIND };
const HAMPTONS = { id: "cohort-hamptons", kind: FW_COHORT_KIND };
const PATH_COHORT = { id: "cohort-sept", kind: "path" };

const guideGrant = (cohortId: string): RoleGrant => ({
  role: "guide",
  scopeType: "cohort",
  scopeId: cohortId,
});
const NO_BRIDGE = { hasAdminClaim: false, staffRowActive: false };
const FULL_BRIDGE = { hasAdminClaim: true, staffRowActive: true };

const actor = (over: Partial<Parameters<typeof resolveFwActor>[0]> = {}) =>
  resolveFwActor({
    session: SESSION,
    grants: [],
    cohort: BOSTON,
    bridge: NO_BRIDGE,
    ...over,
  });

describe("resolveFwActor — the grant route", () => {
  it("a guide/cohort grant for THIS cohort resolves guide", () => {
    expect(actor({ grants: [guideGrant(BOSTON.id)] })).toEqual({ ok: true, via: "grant" });
  });

  it("is per-cohort, never global — Boston's guide is refused in Hamptons", () => {
    // The scopeId match is the whole enforcement; a role-shaped check ("is a
    // guide anywhere") would hand every guide every city's roster.
    expect(actor({ grants: [guideGrant(BOSTON.id)], cohort: HAMPTONS })).toEqual({
      ok: false,
      reason: "not_a_guide",
    });
  });

  it("a guide holding both cohorts resolves in both", () => {
    const grants = [guideGrant(BOSTON.id), guideGrant(HAMPTONS.id)];
    expect(actor({ grants }).ok).toBe(true);
    expect(actor({ grants, cohort: HAMPTONS }).ok).toBe(true);
  });

  it("ignores every non-guide grant shape, including near misses", () => {
    // A parent/family grant whose scopeId happens to equal a cohort id, a
    // student grant, and a guide grant scoped to something other than a cohort.
    for (const grant of [
      { role: "parent", scopeType: "family", scopeId: BOSTON.id },
      { role: "student", scopeType: "student", scopeId: BOSTON.id },
      { role: "guide", scopeType: "family", scopeId: BOSTON.id },
      { role: "guide", scopeType: "student", scopeId: BOSTON.id },
    ] as RoleGrant[]) {
      expect(actor({ grants: [grant] }), JSON.stringify(grant)).toEqual({
        ok: false,
        reason: "not_a_guide",
      });
    }
  });
});

describe("resolveFwActor — the FW-D3 bridge", () => {
  it("admin claim + active staff row + fw cohort resolves guide with NO grant row", () => {
    expect(actor({ bridge: FULL_BRIDGE })).toEqual({ ok: true, via: "bridge" });
  });

  it("the bridge is global across fw cohorts — that is what 'staff run these events' means", () => {
    expect(actor({ bridge: FULL_BRIDGE, cohort: HAMPTONS })).toEqual({ ok: true, via: "bridge" });
  });

  it("REFUSES an admin claim whose staff row was revoked — the stale-JWT rule", () => {
    // resolveStaffAccess makes exactly this call for /crm; FW inherits it rather
    // than inventing a weaker one. A revoked staff member must lose check-in
    // power on their very next action, not when their JWT happens to expire.
    expect(actor({ bridge: { hasAdminClaim: true, staffRowActive: false } })).toEqual({
      ok: false,
      reason: "not_a_guide",
    });
  });

  it("REFUSES an active staff row without the admin claim", () => {
    expect(actor({ bridge: { hasAdminClaim: false, staffRowActive: true } })).toEqual({
      ok: false,
      reason: "not_a_guide",
    });
  });

  it("bridge is checked BEFORE the grant — staff who also hold a grant keep ops power", () => {
    // Unit 5's ops surface keys on `via === "bridge"`. If the grant route won,
    // a staff member who was also granted into the cohort they are running would
    // silently lose cohort/token/guide administration.
    expect(actor({ grants: [guideGrant(BOSTON.id)], bridge: FULL_BRIDGE })).toEqual({
      ok: true,
      via: "bridge",
    });
  });

  it("that same person falls back to `grant` when their staff row is deactivated", () => {
    // Loses ops, keeps check-in — the intended graceful degradation.
    expect(
      actor({
        grants: [guideGrant(BOSTON.id)],
        bridge: { hasAdminClaim: true, staffRowActive: false },
      })
    ).toEqual({ ok: true, via: "grant" });
  });
});

describe("resolveFwActor — the cohort gate", () => {
  it("refuses a missing cohort (fail closed on a load error too)", () => {
    expect(actor({ cohort: null, bridge: FULL_BRIDGE })).toEqual({
      ok: false,
      reason: "cohort_not_found",
    });
  });

  it("refuses a kind='path' cohort for the BRIDGE", () => {
    expect(actor({ cohort: PATH_COHORT, bridge: FULL_BRIDGE })).toEqual({
      ok: false,
      reason: "cohort_not_fw",
    });
  });

  it("refuses a kind='path' cohort for a GUIDE GRANT too — D25 review authority is not FW write authority", () => {
    // The security property this module adds beyond the plan's literal sentence.
    // A guide/cohort grant on a PATH cohort is the Path's D25 reviewer grant:
    // authority to read a cohort's evidence and countersign THROUGH the verify
    // cascade. fw_move_task has no cascade, no gating and no review. Letting the
    // Path grant open it would hand every Path cohort guide a direct editor for
    // their students' records.
    expect(actor({ grants: [guideGrant(PATH_COHORT.id)], cohort: PATH_COHORT })).toEqual({
      ok: false,
      reason: "cohort_not_fw",
    });
  });

  it("refuses any unrecognised kind — the union is closed here, not at the type", () => {
    // `kind` crosses the service-role boundary as a bare string. A value outside
    // the migration's CHECK must be refused, never coerced into meaning 'fw'.
    for (const kind of ["FW", "fw ", "", "founders_weekend"]) {
      expect(actor({ cohort: { id: BOSTON.id, kind }, bridge: FULL_BRIDGE }), kind).toEqual({
        ok: false,
        reason: "cohort_not_fw",
      });
    }
  });

  it("the kind constant matches the migration's CHECK value", () => {
    expect(FW_COHORT_KIND).toBe("fw");
  });
});

describe("resolveFwActor — session presence", () => {
  it("no session → no_session, checked before anything else", () => {
    // Even with a full bridge and a matching grant: the caller belongs at the
    // guide door, and the proxy's fw-login outcome sends them there.
    expect(actor({ session: null, grants: [guideGrant(BOSTON.id)], bridge: FULL_BRIDGE })).toEqual({
      ok: false,
      reason: "no_session",
    });
  });
});

describe("isFwStaffActor", () => {
  it("is true only for a bridge-resolved actor", () => {
    expect(isFwStaffActor({ ok: true, via: "bridge" })).toBe(true);
    expect(isFwStaffActor({ ok: true, via: "grant" })).toBe(false);
    expect(isFwStaffActor({ ok: false, reason: "not_a_guide" })).toBe(false);
  });
});

describe("buildFwGuideCreateUserPayload — the guide account's shape (FW-R5)", () => {
  const build = (email: string) => buildFwGuideCreateUserPayload({ email });

  it("pins email_confirm and the guide role, and carries NO password", () => {
    const payload = build("Ravi@Example.com");
    expect(payload).toEqual({
      email: "ravi@example.com",
      email_confirm: true,
      app_metadata: { role: "guide" },
    });
    expect(Object.keys(payload)).not.toContain("password");
  });

  it("never mints an admin — a guide session must earn crm-staff-only at the proxy", () => {
    expect(build("ravi@example.com").app_metadata.role).not.toBe("admin");
    expect(FW_GUIDE_ROLE).toBe("guide");
  });

  it("REFUSES an address inside the FW student namespace", () => {
    // One typo during a ninety-student import week would otherwise put a
    // password-carrying, sign-in-able account inside the namespace whose entire
    // safety story is "password-less and dormant".
    expect(() => build("maya.chen.fw@the120.school")).toThrow(/FW student namespace/);
    expect(() => build("  MAYA.CHEN.FW@THE120.SCHOOL  ")).toThrow(/FW student namespace/);
    // Including the anonymize tombstone shape, which stays in the namespace.
    expect(() => build("removed-abc.fw@the120.school")).toThrow(/FW student namespace/);
  });

  it("refuses a blank address", () => {
    expect(() => build("   ")).toThrow(/blank guide email/);
  });

  it("allows a staff-domain address that merely lives on the same domain", () => {
    // the120.school is deliverable and shared; only the `.fw@` namespace is
    // reserved. Refusing the whole domain would lock staff out of guiding.
    expect(build("ravi@the120.school").email).toBe("ravi@the120.school");
  });
});

describe("isGuideAccount — the guard on all three credential operations", () => {
  it("accepts an account this system minted as a guide", () => {
    expect(isGuideAccount({ app_metadata: { role: "guide" } })).toBe(true);
  });

  it("REFUSES every other account class", () => {
    // Each of the three call sites (adopt / issue / claim) can hand someone
    // control of the named account. Adopting or crediting a staff account would
    // turn "add a guide" into "mail a working credential for that person's
    // account to whoever staff typed in the address field".
    for (const role of ["admin", "parent", "student", "Guide", "", undefined]) {
      expect(isGuideAccount({ app_metadata: { role } }), String(role)).toBe(false);
    }
    expect(isGuideAccount({ app_metadata: null })).toBe(false);
    expect(isGuideAccount({})).toBe(false);
    expect(isGuideAccount(null)).toBe(false);
  });
});

describe("fwClaimStrikeDisposition — only a real token guess costs a strike", () => {
  it("KEEPS the strike for a dead link — the only outcome a wrong token produces", () => {
    expect(fwClaimStrikeDisposition("dead_link")).toBe("keep");
  });

  it("RELEASES on a weak password — the token was already verified live", () => {
    // Otherwise a guide types "12345" ten times at the check-in table and locks
    // themselves (and everyone behind the venue's NAT) out.
    expect(fwClaimStrikeDisposition("weak_password")).toBe("release");
  });

  it("RELEASES on unavailable — an outage is not an attempt", () => {
    // Load-bearing after the reliability review: an Auth API blip during the
    // Friday-morning claim rush must not consume the venue's shared per-IP
    // budget. This is the branch an inverted comparison would silently break.
    expect(fwClaimStrikeDisposition("unavailable")).toBe("release");
  });
});

describe("fwGuideInviteVerdict — Decision 12", () => {
  const NOW = Date.parse("2026-08-10T12:00:00Z");
  const live = { expiresAt: "2026-08-20T12:00:00Z", claimedAt: null };

  it("a live, unclaimed invite is ok", () => {
    expect(fwGuideInviteVerdict({ invite: live, now: NOW })).toEqual({ ok: true });
  });

  it("no row → not_found", () => {
    expect(fwGuideInviteVerdict({ invite: null, now: NOW })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("single-use is checked BEFORE expiry — a claimed invite reads already_claimed", () => {
    expect(
      fwGuideInviteVerdict({ invite: { ...live, claimedAt: "2026-08-11T09:00:00Z" }, now: NOW })
    ).toEqual({ ok: false, reason: "already_claimed" });
  });

  it("expired → expired, and the boundary is exclusive", () => {
    expect(
      fwGuideInviteVerdict({ invite: { ...live, expiresAt: "2026-08-01T12:00:00Z" }, now: NOW })
    ).toEqual({ ok: false, reason: "expired" });
    // Exactly now is NOT still valid (`!(expires > now)`).
    expect(
      fwGuideInviteVerdict({ invite: { ...live, expiresAt: new Date(NOW).toISOString() }, now: NOW })
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      fwGuideInviteVerdict({ invite: { ...live, expiresAt: new Date(NOW + 1).toISOString() }, now: NOW })
    ).toEqual({ ok: true });
  });

  it("a malformed expiry fails CLOSED, never open", () => {
    // Date.parse → NaN, and `NaN > now` is false. The inverse comparison would
    // read a garbage timestamp as a live standing credential.
    for (const expiresAt of ["", "not-a-date", "2026-13-45T99:00:00Z"]) {
      expect(fwGuideInviteVerdict({ invite: { ...live, expiresAt }, now: NOW }), expiresAt).toEqual({
        ok: false,
        reason: "expired",
      });
    }
  });

  it("has NO session-email branch — the token is the credential", () => {
    // Deliberately unlike inviteVerdict: a guide invite is bound to its account
    // and the claim replaces whatever session the shared iPad was holding. The
    // signature carries no sessionEmail at all, so this cannot regress silently.
    expect(Object.keys(fwGuideInviteVerdict({ invite: live, now: NOW }))).toEqual(["ok"]);
  });
});

describe("FW_GUIDE_INVITE_TTL_MS — its own constant (Decision 12)", () => {
  it("is 14 days, not the parent invite's 7", () => {
    // The plan's arithmetic: a single build-complete issuance would die before or
    // during Hamptons, so invites are issued per event and 14 days covers the gap
    // from issuing a batch to the doors opening.
    expect(FW_GUIDE_INVITE_TTL_MS).toBe(14 * 24 * 60 * 60_000);
    expect(FW_GUIDE_INVITE_TTL_MS).not.toBe(PARENT_INVITE_TTL_MS);
  });

  it("fwGuideInviteExpiry stamps exactly one TTL ahead", () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    expect(Date.parse(fwGuideInviteExpiry(now)) - now).toBe(FW_GUIDE_INVITE_TTL_MS);
  });

  it("an invite issued now is still live one day before expiry and dead one second after", () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    const expiresAt = fwGuideInviteExpiry(now);
    expect(
      fwGuideInviteVerdict({ invite: { expiresAt, claimedAt: null }, now: now + 13 * 86_400_000 })
    ).toEqual({ ok: true });
    expect(
      fwGuideInviteVerdict({
        invite: { expiresAt, claimedAt: null },
        now: now + FW_GUIDE_INVITE_TTL_MS + 1000,
      })
    ).toEqual({ ok: false, reason: "expired" });
  });
});
