import { describe, expect, it } from "vitest";
import {
  deriveAnalyticsScope,
  deriveAnalyticsScopeMode,
  deriveQaFamiliesRateLimitKeys,
  hasQaNameHeuristic,
  parseQaFamilyUpdate,
  shapeQaFamilies,
} from "../qa-families-rules";

const PARENT_A = "11111111-1111-4111-8111-111111111111";
const PARENT_B = "22222222-2222-4222-8222-222222222222";
const REV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WHEN_A = "2026-09-01T12:00:00.000Z";
const WHEN_B = "2026-09-02T12:00:00.000Z";
const member = (parentId: string, childId: string, username: string) => ({
  parentId,
  childId,
  username,
});

const row = (parentId: string, excluded: boolean, revision: string, updatedAt: string) => ({
  parent_id: parentId,
  excluded_from_analytics: excluded,
  revision,
  updated_at: updatedAt,
});

describe("QA family scope rules", () => {
  it("requires an explicit included/all scope and rejects lookalikes", () => {
    expect(deriveAnalyticsScopeMode("included")).toEqual({ ok: true, scope: "included" });
    expect(deriveAnalyticsScopeMode("all")).toEqual({ ok: true, scope: "all" });
    for (const value of [null, "", "Included", "all ", "excluded"]) {
      expect(deriveAnalyticsScopeMode(value)).toEqual({ ok: false, reason: "invalid_scope" });
    }
  });

  it("uses a total, separate rate-limit namespace", () => {
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    expect(() => deriveQaFamiliesRateLimitKeys(loneSurrogate, loneSurrogate)).not.toThrow();
    expect(deriveQaFamiliesRateLimitKeys("2001:db8::1", "staff:x")).toEqual({
      userKey: "fp-qa-families:2001%3Adb8%3A%3A1:staff%3Ax",
      ipKey: "fp-qa-families-ip:2001%3Adb8%3A%3A1",
    });
  });

  it("derives stable opaque scope revisions independent of row order", () => {
    const first = deriveAnalyticsScope(
      [row(PARENT_A, true, REV_A, WHEN_A), row(PARENT_B, false, REV_B, WHEN_B)],
      [member(PARENT_A, "child-a", "kid-a"), member(PARENT_B, "child-b", "kid-b")]
    );
    const reordered = deriveAnalyticsScope(
      [row(PARENT_B, false, REV_B, WHEN_B), row(PARENT_A, true, REV_A, WHEN_A)],
      [member(PARENT_B, "child-b", "kid-b"), member(PARENT_A, "child-a", "kid-a")]
    );
    expect(first.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!first.ok || !reordered.ok) return;
    expect(first.value.scope).toEqual(reordered.value.scope);
    expect(first.value.scope).toMatchObject({ includedFamilies: 1, excludedFamilies: 1 });
    expect(first.value.scope.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.value.scope.revision).not.toContain(PARENT_A);
    expect(first.value.excludedParentIds).toEqual(new Set([PARENT_A]));
  });

  it("changes revision when a decision or row revision changes", () => {
    const members = [member(PARENT_A, "child-a", "kid-a")];
    const a = deriveAnalyticsScope([row(PARENT_A, true, REV_A, WHEN_A)], members);
    const b = deriveAnalyticsScope([row(PARENT_A, false, REV_A, WHEN_A)], members);
    const c = deriveAnalyticsScope([row(PARENT_A, true, REV_B, WHEN_A)], members);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.value.scope.revision).not.toBe(b.value.scope.revision);
    expect(a.value.scope.revision).not.toBe(c.value.scope.revision);
  });

  it("changes revision when an enrolled child or username changes", () => {
    const rows = [row(PARENT_A, false, REV_A, WHEN_A)];
    const first = deriveAnalyticsScope(rows, [member(PARENT_A, "child-a", "kid-a")]);
    const added = deriveAnalyticsScope(rows, [
      member(PARENT_A, "child-a", "kid-a"),
      member(PARENT_A, "child-b", "kid-b"),
    ]);
    const renamed = deriveAnalyticsScope(rows, [member(PARENT_A, "child-a", "kid-renamed")]);
    expect(first.ok && added.ok && renamed.ok).toBe(true);
    if (!first.ok || !added.ok || !renamed.ok) return;
    expect(first.value.scope.revision).not.toBe(added.value.scope.revision);
    expect(first.value.scope.revision).not.toBe(renamed.value.scope.revision);
    expect(added.value.scope.includedFamilies).toBe(1);
  });

  it("fails closed on malformed or duplicate database rows", () => {
    expect(
      deriveAnalyticsScope(
        [row(PARENT_A, true, "not-a-db-revision", WHEN_A)],
        [member(PARENT_A, "child-a", "kid-a")]
      )
    ).toEqual({ ok: false, reason: "invalid_scope_row" });
    expect(
      deriveAnalyticsScope(
        [row(PARENT_A, true, REV_A, WHEN_A), row(PARENT_A, false, REV_B, WHEN_B)],
        [member(PARENT_A, "child-a", "kid-a")]
      )
    ).toEqual({ ok: false, reason: "invalid_scope_row" });
  });

  it("suggests four consecutive digits only; the heuristic itself performs no write", () => {
    expect(hasQaNameHeuristic("Kid 1234", null)).toBe(true);
    expect(hasQaNameHeuristic("Kid 12 34", "qa-999")).toBe(false);
    expect(hasQaNameHeuristic("normal", "qa_00001")).toBe(true);
  });

  it("shapes enrolled families without email/phone and never auto-excludes a suggestion", () => {
    const shaped = shapeQaFamilies(
      [
        { id: PARENT_A, first_name: "Parent", last_name: "1234" },
        { id: PARENT_B, first_name: "Real", last_name: "Family" },
      ],
      [
        {
          id: "child-a-1",
          parent_id: PARENT_A,
          first_name: "Kid",
          last_name: "One",
          fp_username: "qa-kid",
        },
        {
          id: "child-a-2",
          parent_id: PARENT_A,
          first_name: "Kid",
          last_name: "Two",
          fp_username: "qa-kid-2",
        },
        {
          id: "child-b",
          parent_id: PARENT_B,
          first_name: "Normal",
          last_name: "Kid",
          fp_username: "normal",
        },
        // No username means not enrolled and must not create a family entry.
        {
          id: "not-enrolled",
          parent_id: "33333333-3333-4333-8333-333333333333",
          fp_username: null,
        },
      ],
      [row(PARENT_B, true, REV_B, WHEN_B)]
    );
    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;
    expect(shaped.families).toEqual([
      {
        parentId: PARENT_A,
        parentName: "Parent 1234",
        childUsernames: ["qa-kid", "qa-kid-2"],
        heuristicSuggested: true,
        excludedFromAnalytics: false,
        updatedAt: null,
      },
      {
        parentId: PARENT_B,
        parentName: "Real Family",
        childUsernames: ["normal"],
        heuristicSuggested: false,
        excludedFromAnalytics: true,
        updatedAt: WHEN_B,
      },
    ]);
    const wire = JSON.stringify(shaped);
    expect(wire).not.toMatch(/email|phone/i);
  });

  it("accepts only the exact strict POST body", () => {
    expect(
      parseQaFamilyUpdate({ parentId: PARENT_A.toUpperCase(), excludedFromAnalytics: true })
    ).toEqual({ parentId: PARENT_A, excludedFromAnalytics: true });
    for (const value of [
      null,
      {},
      { parentId: PARENT_A },
      { parentId: "parent-1", excludedFromAnalytics: true },
      { parentId: PARENT_A, excludedFromAnalytics: "true" },
      { parentId: PARENT_A, excludedFromAnalytics: true, email: "leak@example.com" },
    ]) {
      expect(parseQaFamilyUpdate(value), JSON.stringify(value)).toBeNull();
    }
  });
});
