import { describe, expect, it } from "vitest";

import {
  buildStudentCreateUserPayload,
  buildStudentGrants,
  deriveStudentEmail,
  isParentOfFamily,
  normalizeStudentName,
  parseCandidateRow,
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_RATE_LIMITED_MESSAGE,
  STUDENT_EMAIL_DOMAIN,
  studentNameMatches,
  validateStudentPassword,
} from "../provision-rules";
import type { RoleGrant } from "../access-rules";

const CHILD_ID = "3F2504E0-4f89-11D3-9A0C-0305E82C3301";

describe("deriveStudentEmail — the system-generated, non-deliverable address", () => {
  it("derives on the reserved .invalid TLD so the address can NEVER receive mail", () => {
    // RFC 2606 reserves .invalid; the Unit 2 spike proved Supabase accepts it.
    expect(STUDENT_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true);
    expect(deriveStudentEmail(CHILD_ID).endsWith(`@${STUDENT_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("is stable and unique per child (keyed on the child id, lowercased)", () => {
    const a = deriveStudentEmail(CHILD_ID);
    expect(deriveStudentEmail(CHILD_ID)).toBe(a); // stable
    expect(a).toBe(a.toLowerCase()); // email-safe casing
    expect(a).toContain(CHILD_ID.toLowerCase());
    const b = deriveStudentEmail("11111111-2222-4333-8444-555555555555");
    expect(b).not.toBe(a); // unique per child
    expect(a.split("@")).toHaveLength(2); // exactly one @
  });

  it("FAILS CLOSED on a malformed child id (empty, whitespace, @)", () => {
    expect(() => deriveStudentEmail("")).toThrow();
    expect(() => deriveStudentEmail("   ")).toThrow();
    expect(() => deriveStudentEmail("abc @def")).toThrow();
    expect(() => deriveStudentEmail("abc@def")).toThrow();
  });
});

describe("buildStudentCreateUserPayload — the admin.createUser contract", () => {
  const payload = buildStudentCreateUserPayload({ childId: CHILD_ID, password: "horse-battery-staple" });

  it("ALWAYS carries email_confirm: true — omitting it permanently locks the child out", () => {
    // The hosted project has confirmations ON (config.toml lies). Without this flag
    // the account is created but can never sign in, and the non-deliverable address
    // means no rescue email ever arrives. See docs/solutions/integration-issues/
    // supabase-admin-createuser-non-deliverable-email-requires-email-confirm-2026-07-21.md
    expect(payload.email_confirm).toBe(true);
  });

  it("derives the email and passes the parent-set password through", () => {
    expect(payload.email).toBe(deriveStudentEmail(CHILD_ID));
    expect(payload.password).toBe("horse-battery-staple");
  });

  it("stamps app_metadata.role = student (server-set, never client-writable)", () => {
    expect(payload.app_metadata).toEqual({ role: "student" });
  });

  it("carries exactly the four intended keys — nothing extra rides into createUser", () => {
    expect(Object.keys(payload).sort()).toEqual([
      "app_metadata",
      "email",
      "email_confirm",
      "password",
    ]);
  });
});

describe("normalizeStudentName / studentNameMatches", () => {
  it("trims, collapses inner whitespace, and lowercases", () => {
    expect(normalizeStudentName("  Maya   Rose ")).toBe("maya rose");
    expect(normalizeStudentName("MAYA")).toBe("maya");
    expect(normalizeStudentName("maya\trose")).toBe("maya rose");
  });

  it("normalizes unicode so composed and decomposed forms match", () => {
    const composed = "Mi\u00e1"; // precomposed a-acute
    const decomposed = "Mia\u0301"; // a + combining acute accent
    expect(composed).not.toBe(decomposed); // genuinely different code-point sequences
    expect(normalizeStudentName(composed)).toBe(normalizeStudentName(decomposed));
    expect(studentNameMatches(composed, decomposed)).toBe(true);
  });

  it("matches across case and spacing", () => {
    expect(studentNameMatches("Maya", "  maya ")).toBe(true);
    expect(studentNameMatches("Maya Rose", "MAYA  ROSE")).toBe(true);
  });

  it("does not match different names", () => {
    expect(studentNameMatches("Maya", "Mia")).toBe(false);
    expect(studentNameMatches("Maya Rose", "Maya")).toBe(false);
  });

  it("FAILS CLOSED on empty names — a draft CRM row (first_name = '') must never match", () => {
    // public.children.first_name defaults to '' and CRM rows start as drafts.
    expect(studentNameMatches("", "")).toBe(false);
    expect(studentNameMatches("", "Maya")).toBe(false);
    expect(studentNameMatches("Maya", "")).toBe(false);
    expect(studentNameMatches("   ", "   ")).toBe(false);
  });
});

describe("validateStudentPassword — the R29 strength floor", () => {
  it("accepts a kid-friendly passphrase at or above 10 characters", () => {
    expect(validateStudentPassword("purple dragon 7", {})).toEqual({ ok: true });
    expect(validateStudentPassword("abcdefghij", {})).toEqual({ ok: true }); // exactly 10
  });

  it("rejects below 10 characters with a message that names the floor", () => {
    const out = validateStudentPassword("short1", {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("10");
  });

  it("rejects over 72 characters (bcrypt truncation boundary)", () => {
    const out = validateStudentPassword("x".repeat(73), {});
    expect(out.ok).toBe(false);
  });

  it("measures BYTES, not code units — a multi-byte passphrase over 72 bytes is refused", () => {
    // Varied katakana (10 distinct chars, so it clears the repetition check and is
    // rejected specifically on byte length): 30 chars = JS length 30 (< 72) but
    // ~90 UTF-8 bytes — past bcrypt's 72-BYTE truncation point. A `.length` check
    // would wave it through and let bcrypt silently truncate it.
    const cjk = "アイウエオカキクケコ".repeat(3);
    expect(cjk.length).toBeLessThanOrEqual(72);
    expect(new Set(cjk).size).toBeGreaterThanOrEqual(4); // not rejected as repetitive
    expect(new TextEncoder().encode(cjk).length).toBeGreaterThan(72);
    expect(validateStudentPassword(cjk, {}).ok).toBe(false);
  });

  it("still accepts a multi-byte passphrase that fits within 72 bytes", () => {
    const accented = "café rocket 42"; // one 2-byte char, ~16 bytes total
    expect(new TextEncoder().encode(accented).length).toBeLessThanOrEqual(72);
    expect(validateStudentPassword(accented, {}).ok).toBe(true);
  });

  it("rejects highly repetitive passwords", () => {
    expect(validateStudentPassword("aaaaaaaaaa", {}).ok).toBe(false);
    expect(validateStudentPassword("ababababab", {}).ok).toBe(false);
  });

  it("rejects passwords built on trivially guessable strings", () => {
    expect(validateStudentPassword("password123", {}).ok).toBe(false);
    expect(validateStudentPassword("1234567890", {}).ok).toBe(false);
  });

  it("rejects a password containing the student's name — a name is the guessable unit here", () => {
    const out = validateStudentPassword("maya1234567", { studentName: "Maya" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.toLowerCase()).toContain("name");
    // Case- and spacing-insensitive.
    expect(validateStudentPassword("xxMAYAxx99", { studentName: "maya" }).ok).toBe(false);
    // Multi-token names: each token of 3+ chars is checked.
    expect(validateStudentPassword("rosebud490", { studentName: "Maya Rose" }).ok).toBe(false);
  });

  it("skips the name rule for tokens shorter than 3 chars (too many false positives)", () => {
    expect(validateStudentPassword("calibrated7", { studentName: "Al" })).toEqual({ ok: true });
  });

  it("passes a strong password even when a name is supplied", () => {
    expect(validateStudentPassword("green rocket 42", { studentName: "Maya" })).toEqual({
      ok: true,
    });
  });

  it("catches the student's name embedded in DECOMPOSED unicode (password normalized symmetrically)", () => {
    // Name normalizes (NFKC) to a composed "josé"; the password spells the same
    // name in decomposed form (e + combining acute). Without normalizing the
    // password too, `includes` would miss it — the asymmetry F14 closed.
    const composedName = "Jos\u00e9"; // Jose + precomposed acute
    const decomposedInPw = "jose\u0301bicycle"; // jose + COMBINING acute + filler (>=10 chars)
    expect(validateStudentPassword(decomposedInPw, { studentName: composedName }).ok).toBe(false);
  });
});

describe("buildStudentGrants — the provisioned two-grant pair", () => {
  it("emits exactly the self grant + the family-membership grant, insert-ready", () => {
    const rows = buildStudentGrants({
      userId: "user-1",
      profileId: "prof-1",
      familyId: "fam-1",
    });
    expect(rows).toEqual([
      { user_id: "user-1", role: "student", scope_type: "student", scope_id: "prof-1" },
      { user_id: "user-1", role: "student", scope_type: "family", scope_id: "fam-1" },
    ]);
  });
});

describe("isParentOfFamily — provisioning/reset authority (R32; stricter than read access)", () => {
  const parentOfFam1: RoleGrant[] = [{ role: "parent", scopeType: "family", scopeId: "fam-1" }];

  it("either parent of THE family may act", () => {
    expect(isParentOfFamily(parentOfFam1, "fam-1")).toBe(true);
  });

  it("a parent of another family is refused", () => {
    expect(isParentOfFamily(parentOfFam1, "fam-2")).toBe(false);
  });

  it("a GUIDE is refused — a D25 read grant is never reset/provision authority", () => {
    const guide: RoleGrant[] = [{ role: "guide", scopeType: "cohort", scopeId: "coh-1" }];
    expect(isParentOfFamily(guide, "fam-1")).toBe(false);
    // Even a crafted guide grant whose scopeId collides with the family id.
    const crafted: RoleGrant[] = [{ role: "guide", scopeType: "family", scopeId: "fam-1" }];
    expect(isParentOfFamily(crafted, "fam-1")).toBe(false);
  });

  it("a student (self or sibling) is refused — kids never reset kids", () => {
    const sibling: RoleGrant[] = [
      { role: "student", scopeType: "student", scopeId: "prof-1" },
      { role: "student", scopeType: "family", scopeId: "fam-1" },
    ];
    expect(isParentOfFamily(sibling, "fam-1")).toBe(false);
  });

  it("no grants → refused", () => {
    expect(isParentOfFamily([], "fam-1")).toBe(false);
  });
});

describe("parseCandidateRow — fail-closed narrowing of the sign-in candidate join", () => {
  const valid = {
    id: "prof-1",
    user_id: "user-1",
    child_id: "child-1",
    family_id: "fam-1",
    children: { first_name: "Maya" },
  };

  it("parses a well-formed row (object embed)", () => {
    expect(parseCandidateRow(valid)).toEqual({
      profileId: "prof-1",
      userId: "user-1",
      childId: "child-1",
      familyId: "fam-1",
      firstName: "Maya",
    });
  });

  it("tolerates PostgREST's single-element-array embed shape", () => {
    expect(parseCandidateRow({ ...valid, children: [{ first_name: "Maya" }] })).toEqual(
      parseCandidateRow(valid)
    );
  });

  it("DROPS a row with a missing or ambiguous embed — never guesses", () => {
    expect(parseCandidateRow({ ...valid, children: null })).toBeNull();
    expect(parseCandidateRow({ ...valid, children: undefined })).toBeNull();
    expect(parseCandidateRow({ ...valid, children: [] })).toBeNull();
    expect(
      parseCandidateRow({ ...valid, children: [{ first_name: "A" }, { first_name: "B" }] })
    ).toBeNull();
  });

  it("DROPS a row whose ids or name are not strings", () => {
    expect(parseCandidateRow({ ...valid, user_id: null })).toBeNull();
    expect(parseCandidateRow({ ...valid, id: 7 })).toBeNull();
    expect(parseCandidateRow({ ...valid, family_id: undefined })).toBeNull();
    expect(parseCandidateRow({ ...valid, children: { first_name: 42 } })).toBeNull();
  });
});

describe("sign-in messages — generic by design (no account enumeration)", () => {
  it("the failure message never hints at the system email or which names exist", () => {
    expect(SIGN_IN_FAILED_MESSAGE.length).toBeGreaterThan(0);
    expect(SIGN_IN_FAILED_MESSAGE.toLowerCase()).not.toContain("email");
    expect(SIGN_IN_FAILED_MESSAGE.toLowerCase()).not.toContain("account");
  });

  it("the rate-limited message tells the student to wait, nothing more", () => {
    expect(SIGN_IN_RATE_LIMITED_MESSAGE.length).toBeGreaterThan(0);
    expect(SIGN_IN_RATE_LIMITED_MESSAGE.toLowerCase()).not.toContain("email");
  });
});
