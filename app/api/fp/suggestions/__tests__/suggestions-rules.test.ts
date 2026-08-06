import { describe, expect, it } from "vitest";
import { readStaffRoleCheckRoles } from "@/app/api/fp/__tests__/helpers/staff-role-check";
import {
  deriveSuggestionsRateLimitKeys,
  isAllowedStaffRole,
  shapeSuggestions,
  shapeSuggestionsRefusal,
  SUGGESTIONS_ALLOWED_STAFF_ROLES,
  SUGGESTIONS_IP_RATE_LIMIT,
  SUGGESTIONS_PAGE_CAP,
  SUGGESTIONS_RATE_LIMIT,
  type SuggestionsRefusalReason,
} from "../suggestions-rules";

describe("suggestions rules — staff role vocabulary", () => {
  it("is exactly the production vocabulary: ['admin'] (no super_admin/staff values exist)", () => {
    expect(SUGGESTIONS_ALLOWED_STAFF_ROLES).toEqual(["admin"]);
  });

  it("parity: the allowed set equals the staff table's role CHECK (crm_core migration)", () => {
    // The role vocabulary lives in the DB CHECK; if it is ever widened
    // (super_admin / staff tiers), this endpoint's allowed set must be widened
    // in the same change — this parse holds the two lists together. The PARSE
    // is shared with the progress endpoint's test; the ASSERTION stays here, so
    // the two endpoints' allowed sets remain independent decisions.
    expect([...SUGGESTIONS_ALLOWED_STAFF_ROLES]).toEqual(readStaffRoleCheckRoles());
  });

  it("isAllowedStaffRole: exact string membership only", () => {
    expect(isAllowedStaffRole("admin")).toBe(true);
    for (const v of ["", "Admin", "ADMIN", "admin ", "super_admin", "staff", null, undefined, 1, {}]) {
      expect(isAllowedStaffRole(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe("suggestions rules — refusal shaping", () => {
  it("every reason produces the SAME byte-identical 401 (no oracle)", () => {
    const reasons: SuggestionsRefusalReason[] = [
      "missing_token",
      "invalid_token",
      "not_staff",
      "rate_limited",
      "outage",
    ];
    const shaped = reasons.map((r) => shapeSuggestionsRefusal(r));
    for (const s of shaped) expect(s.status).toBe(401);
    for (const s of shaped) expect(s.body).toBe(shaped[0]!.body);
    // The body is the login surface's voice — a generic sign-in failure, no
    // mention of staff, roles, or this endpoint's purpose.
    expect(shaped[0]!.body).not.toMatch(/staff|role|suggestion|admin/i);
    const parsed = JSON.parse(shaped[0]!.body) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe("string");
  });
});

describe("suggestions rules — rate limiting", () => {
  it("budgets are bounded and the IP aggregate dominates the per-user budget", () => {
    expect(SUGGESTIONS_RATE_LIMIT.limit).toBeGreaterThan(0);
    expect(SUGGESTIONS_IP_RATE_LIMIT.limit).toBeGreaterThanOrEqual(SUGGESTIONS_RATE_LIMIT.limit);
  });

  it("composite keys escape both segments — no ':' aliasing across (ip,user) pairs", () => {
    const a = deriveSuggestionsRateLimitKeys("2001:db8::1", "user:x");
    const b = deriveSuggestionsRateLimitKeys("2001:db8:", ":1:user:x");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.userKey).toContain("fp-suggestions:");
    expect(a.ipKey).toContain("fp-suggestions-ip:");
    // Own namespace — never shared with login/grade buckets.
    expect(a.userKey.startsWith("fp-grade")).toBe(false);
  });

  it("well-formed input keeps the SHIPPED key format byte-for-byte", () => {
    expect(deriveSuggestionsRateLimitKeys("1.2.3.4", "sub-1")).toEqual({
      userKey: "fp-suggestions:1.2.3.4:sub-1",
      ipKey: "fp-suggestions-ip:1.2.3.4",
    });
    expect(deriveSuggestionsRateLimitKeys("2001:db8::1", "user:x")).toEqual({
      userKey: "fp-suggestions:2001%3Adb8%3A%3A1:user%3Ax",
      ipKey: "fp-suggestions-ip:2001%3Adb8%3A%3A1",
    });
  });

  it("is TOTAL: a lone-surrogate sub does not throw before the strikes are recorded", () => {
    // encodeURIComponent("\ud800") throws URIError. unverifiedJwtSub returns
    // the claim unvalidated, and the route derives these keys BEFORE any DB
    // I/O — so the throw would land before either bucket is written, bypassing
    // throttling entirely and 500ing instead of refusing.
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    expect(() => deriveSuggestionsRateLimitKeys("1.2.3.4", loneSurrogate)).not.toThrow();
    expect(() => deriveSuggestionsRateLimitKeys(loneSurrogate, "sub-1")).not.toThrow();
  });
});

describe("suggestions rules — page cap", () => {
  it("is the documented 200-row triage window", () => {
    expect(SUGGESTIONS_PAGE_CAP).toBe(200);
  });
});

describe("suggestions rules — shapeSuggestions", () => {
  const row = (over: Partial<Parameters<typeof shapeSuggestions>[0][number]> = {}) => ({
    id: "f-1",
    profile_id: "p-1",
    kind: "task" as unknown,
    task_id: "1.2.5",
    body: "hi",
    created_at: "2026-08-03T12:00:00Z",
    ...over,
  });
  const profile = { id: "p-1", handle: "alexh", child_id: "c-1" };
  const child = { id: "c-1", fp_username: "alex.fp" };

  it("projects the contract shape with the fp_username join", () => {
    expect(shapeSuggestions([row()], [profile], [child])).toEqual([
      {
        id: "f-1",
        kind: "task",
        taskId: "1.2.5",
        username: "alex.fp",
        body: "hi",
        createdAt: "2026-08-03T12:00:00Z",
      },
    ]);
  });

  it("carries both kinds through; a pre-migration row (no kind) reads as 'task'", () => {
    const shaped = shapeSuggestions(
      [row({ id: "a", kind: "app" }), row({ id: "b", kind: undefined }), row({ id: "c", kind: "task" })],
      [profile],
      [child]
    );
    expect(shaped.map((s) => s.kind)).toEqual(["app", "task", "task"]);
  });

  it("falls back to the profile handle when fp_username is null/empty (pre-backfill child)", () => {
    expect(shapeSuggestions([row()], [profile], [{ id: "c-1", fp_username: null }])[0]!.username).toBe("alexh");
    expect(shapeSuggestions([row()], [profile], [{ id: "c-1", fp_username: "" }])[0]!.username).toBe("alexh");
  });

  it("a fully broken join (profile row missing) yields username null, never a throw", () => {
    expect(shapeSuggestions([row()], [], [])[0]!.username).toBeNull();
  });

  it("preserves the caller's (newest-first) row order", () => {
    const shaped = shapeSuggestions(
      [row({ id: "newest" }), row({ id: "older" })],
      [profile],
      [child]
    );
    expect(shaped.map((s) => s.id)).toEqual(["newest", "older"]);
  });
});
