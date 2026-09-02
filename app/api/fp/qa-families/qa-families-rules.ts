/** Pure rules for the staff-only First Profit analytics-cohort editor. */

import { createHash } from "node:crypto";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";

export const QA_FAMILIES_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 300,
};
export const QA_FAMILIES_IP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60_000,
  limit: 600,
};

export function deriveQaFamiliesRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipPart = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-qa-families:${ipPart}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-qa-families-ip:${ipPart}`,
  };
}

export type AnalyticsScopeMode = "included" | "all";

export function deriveAnalyticsScopeMode(
  raw: string | null
): { ok: true; scope: AnalyticsScopeMode } | { ok: false; reason: "invalid_scope" } {
  return raw === "included" || raw === "all"
    ? { ok: true, scope: raw }
    : { ok: false, reason: "invalid_scope" };
}

export type WatchtowerScopeRowLike = {
  parent_id?: unknown;
  excluded_from_analytics?: unknown;
  revision?: unknown;
  updated_at?: unknown;
};

export type AnalyticsScope = {
  revision: string;
  includedFamilies: number;
  excludedFamilies: number;
};

type DerivedAnalyticsScope = {
  scope: AnalyticsScope;
  excludedParentIds: Set<string>;
  rowByParentId: Map<string, { excluded: boolean; updatedAt: string }>;
};

export type AnalyticsScopeMember = {
  parentId: string;
  childId: string;
  username: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

/**
 * Derive one opaque revision from the complete scope table snapshot.
 *
 * The row's UUID revision is database-generated and changes only when its
 * include/exclude decision changes. Hashing the sorted rows prevents parent ids
 * or audit data from leaking onto the wire while making every response fetched
 * from the same snapshot carry exactly the same merge token.
 */
export function deriveAnalyticsScope(
  rows: readonly WatchtowerScopeRowLike[],
  enrolledMembers: readonly AnalyticsScopeMember[]
): { ok: true; value: DerivedAnalyticsScope } | { ok: false; reason: "invalid_scope_row" } {
  const canonical: string[] = [];
  const excludedParentIds = new Set<string>();
  const rowByParentId = new Map<string, { excluded: boolean; updatedAt: string }>();

  for (const row of rows) {
    const parentId = row.parent_id;
    const excluded = row.excluded_from_analytics;
    const revision = row.revision;
    const updatedAt = row.updated_at;
    if (
      typeof parentId !== "string" ||
      parentId.length === 0 ||
      parentId.length > 128 ||
      typeof excluded !== "boolean" ||
      typeof revision !== "string" ||
      !UUID_PATTERN.test(revision) ||
      !validDateString(updatedAt) ||
      rowByParentId.has(parentId)
    ) {
      return { ok: false, reason: "invalid_scope_row" };
    }
    rowByParentId.set(parentId, { excluded, updatedAt });
    if (excluded) excludedParentIds.add(parentId);
    canonical.push(`${parentId}\u001f${excluded ? "1" : "0"}\u001f${revision}`);
  }
  canonical.sort();

  const enrolled = new Set<string>();
  const canonicalMembers: string[] = [];
  for (const member of enrolledMembers) {
    if (
      typeof member.parentId !== "string" ||
      member.parentId.length === 0 ||
      member.parentId.length > 128 ||
      typeof member.childId !== "string" ||
      member.childId.length === 0 ||
      member.childId.length > 128 ||
      typeof member.username !== "string" ||
      member.username.length === 0 ||
      member.username.length > 128
    ) {
      return { ok: false, reason: "invalid_scope_row" };
    }
    enrolled.add(member.parentId);
    canonicalMembers.push(
      `${member.parentId}\u001f${member.childId}\u001f${member.username}`
    );
  }
  canonicalMembers.sort();
  const memberFingerprint = canonicalMembers.join("\n");
  const scopedFingerprint = canonical.join("\n");
  const revision = `sha256:${createHash("sha256")
    .update("fp-watchtower-scope-v2\n")
    .update(scopedFingerprint)
    .update("\n--members--\n")
    .update(memberFingerprint)
    .digest("hex")}`;
  let excludedFamilies = 0;
  for (const parentId of enrolled) {
    if (excludedParentIds.has(parentId)) excludedFamilies += 1;
  }

  return {
    ok: true,
    value: {
      scope: {
        revision,
        includedFamilies: enrolled.size - excludedFamilies,
        excludedFamilies,
      },
      excludedParentIds,
      rowByParentId,
    },
  };
}

export type QaFamilyParentRowLike = {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
};

export type QaFamilyChildRowLike = {
  id?: unknown;
  parent_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  fp_username?: unknown;
};

export type QaFamily = {
  parentId: string;
  parentName: string | null;
  childUsernames: string[];
  heuristicSuggested: boolean;
  excludedFromAnalytics: boolean;
  updatedAt: string | null;
};

function boundedPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : null;
}

function joinedName(first: unknown, last: unknown): string | null {
  const parts = [boundedPart(first), boundedPart(last)].filter(
    (part): part is string => part !== null
  );
  if (parts.length === 0) return null;
  const value = parts.join(" ");
  return value.length <= 160 ? value : null;
}

function boundedUsername(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

/** Advisory only. Nothing in this module turns a suggestion into a write. */
export function hasQaNameHeuristic(...values: readonly (string | null)[]): boolean {
  return values.some((value) => value !== null && /[0-9]{4,}/.test(value));
}

export function shapeQaFamilies(
  parents: readonly QaFamilyParentRowLike[],
  children: readonly QaFamilyChildRowLike[],
  scopeRows: readonly WatchtowerScopeRowLike[]
):
  | { ok: true; families: QaFamily[]; scope: AnalyticsScope }
  | { ok: false; reason: "invalid_scope_row" } {
  const enrolledChildren = children.flatMap((child) => {
    const childId = child.id;
    const parentId = child.parent_id;
    const username = boundedUsername(child.fp_username);
    if (
      typeof childId !== "string" ||
      childId.length === 0 ||
      childId.length > 128 ||
      typeof parentId !== "string" ||
      parentId.length === 0 ||
      parentId.length > 128
    ) {
      return [];
    }
    if (!username) return [];
    return [
      {
        parentId,
        childId,
        username,
        childName: joinedName(child.first_name, child.last_name),
      },
    ];
  });
  const derived = deriveAnalyticsScope(
    scopeRows,
    enrolledChildren.map((child) => ({
      parentId: child.parentId,
      childId: child.childId,
      username: child.username,
    }))
  );
  if (!derived.ok) return derived;

  const parentById = new Map<string, QaFamilyParentRowLike>();
  for (const parent of parents) {
    if (typeof parent.id === "string" && !parentById.has(parent.id)) {
      parentById.set(parent.id, parent);
    }
  }

  const childGroups = new Map<string, { usernames: Set<string>; names: (string | null)[] }>();
  for (const child of enrolledChildren) {
    const group = childGroups.get(child.parentId) ?? {
      usernames: new Set<string>(),
      names: [],
    };
    group.usernames.add(child.username);
    group.names.push(child.childName);
    childGroups.set(child.parentId, group);
  }

  const families = [...childGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([parentId, group]): QaFamily => {
      const parent = parentById.get(parentId);
      const parentName = parent
        ? joinedName(parent.first_name, parent.last_name)
        : null;
      const childUsernames = [...group.usernames].sort((a, b) => a.localeCompare(b));
      const row = derived.value.rowByParentId.get(parentId);
      return {
        parentId,
        parentName,
        childUsernames,
        heuristicSuggested: hasQaNameHeuristic(
          parentName,
          ...group.names,
          ...childUsernames
        ),
        excludedFromAnalytics: row?.excluded ?? false,
        updatedAt: row?.updatedAt ?? null,
      };
    });

  return { ok: true, families, scope: derived.value.scope };
}

export type QaFamilyUpdate = {
  parentId: string;
  excludedFromAnalytics: boolean;
};

export function parseQaFamilyUpdate(value: unknown): QaFamilyUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, "parentId") ||
    !Object.hasOwn(record, "excludedFromAnalytics") ||
    typeof record.parentId !== "string" ||
    !UUID_PATTERN.test(record.parentId) ||
    typeof record.excludedFromAnalytics !== "boolean"
  ) {
    return null;
  }
  return {
    parentId: record.parentId.toLowerCase(),
    excludedFromAnalytics: record.excludedFromAnalytics,
  };
}
