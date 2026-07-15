/**
 * Ambassador reporting aggregation (GTM-4) — pure functions, no I/O, so the
 * per-code tally stays unit-testable like the rest of `gtm.ts`.
 *
 * The dashboard's Source & ambassador tally already derives leads/deposits per
 * AMB-* code from `families.referral_code`, but it can only show codes that
 * already have a signup and it has no notion of *who owns* a code. GTM-4 adds
 * the missing half: a lightweight registry of issued codes (owner name) so the
 * report lists every issued code — including ones with zero signups yet, the
 * exact state a freshly-issued W2 code is in — and flags signup codes that
 * nobody has claimed an owner for.
 *
 * `computeAmbassadorReport` unions the registry with the codes seen in signups
 * so neither source can hide a row.
 */

import { z } from "zod";

/* --------------------------------------------------------------- registry */

/** One `ambassador_codes` row (the issued-code registry). */
export interface AmbassadorCode {
  code: string;
  ownerName: string;
  note: string;
  createdAt: string;
}

/** The `families` fields the report reads (live rows only). */
export interface AmbassadorSignupFamily {
  id: string;
  referralCode: string;
  /** Linked to a real parent account (vs a hand-added CRM lead). */
  hasAccount: boolean;
}

/* ----------------------------------------------------------------- report */

export interface AmbassadorReportRow {
  code: string;
  ownerName: string;
  /** In the registry (true) or seen only in signups and needs an owner. */
  registered: boolean;
  /** Families carrying this code (accounts + hand-added leads). */
  leads: number;
  /** Subset of `leads` linked to a real parent account. */
  accounts: number;
  /** Paid deposits from families carrying this code. */
  deposits: number;
}

export interface AmbassadorReport {
  rows: AmbassadorReportRow[];
  totals: { codes: number; leads: number; accounts: number; deposits: number };
  /** Rows seen in signups but absent from the registry (need an owner). */
  unregisteredCount: number;
}

/** Canonical code form — trimmed + uppercased, matching the signup path
 *  (`referralCode.trim().toUpperCase()`) so a case/space typo can't split a
 *  tally. Returns "" for a blank code (skipped by the aggregation). */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Per-code leads / accounts / deposits, unioning the issued-code registry with
 * the codes actually seen in signups. `depositFamilyIds` carries one entry per
 * counted paid deposit (duplicates OK — a family with two paid deposits counts
 * twice, matching the dashboard's Source tally). Rows sort deposits-first, then
 * leads, then code — so a registered code with no signups yet sinks to the
 * bottom but never disappears.
 */
export function computeAmbassadorReport(
  registry: AmbassadorCode[],
  families: AmbassadorSignupFamily[],
  depositFamilyIds: string[]
): AmbassadorReport {
  const owners = new Map<string, string>();
  for (const r of registry) {
    const code = normalizeCode(r.code);
    if (code) owners.set(code, r.ownerName.trim());
  }

  const byId = new Map(families.map((f) => [f.id, f]));
  const leads = new Map<string, number>();
  const accounts = new Map<string, number>();
  const deposits = new Map<string, number>();

  const bump = (map: Map<string, number>, code: string) =>
    map.set(code, (map.get(code) ?? 0) + 1);

  for (const f of families) {
    const code = normalizeCode(f.referralCode);
    if (!code) continue;
    bump(leads, code);
    if (f.hasAccount) bump(accounts, code);
  }

  for (const id of depositFamilyIds) {
    const f = byId.get(id);
    if (!f) continue;
    const code = normalizeCode(f.referralCode);
    if (code) bump(deposits, code);
  }

  // Union: every registry code (even zero-signup) + every code seen in signups.
  const codes = new Set<string>([...owners.keys(), ...leads.keys()]);

  const rows: AmbassadorReportRow[] = [...codes]
    .map((code) => ({
      code,
      ownerName: owners.get(code) ?? "",
      registered: owners.has(code),
      leads: leads.get(code) ?? 0,
      accounts: accounts.get(code) ?? 0,
      deposits: deposits.get(code) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.deposits - a.deposits ||
        b.leads - a.leads ||
        a.code.localeCompare(b.code)
    );

  return {
    rows,
    totals: {
      codes: rows.length,
      leads: rows.reduce((n, r) => n + r.leads, 0),
      accounts: rows.reduce((n, r) => n + r.accounts, 0),
      deposits: rows.reduce((n, r) => n + r.deposits, 0),
    },
    unregisteredCount: rows.filter((r) => !r.registered).length,
  };
}

/* ------------------------------------------------------- action schemas */

/** Register / update one issued code. Code shape mirrors the signup field
 *  (letters, digits, dashes; the `AMB-NAME` convention isn't forced so staff
 *  can use other schemes). Zod trims so the server stores canonical values. */
export const registerAmbassadorSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code is too short")
    .max(24, "Code is too long")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and dashes only"),
  ownerName: z.string().trim().min(1, "Add an owner name").max(80),
  note: z.string().trim().max(200).optional(),
});

export const removeAmbassadorSchema = z.object({
  code: z.string().trim().min(2).max(24),
});
