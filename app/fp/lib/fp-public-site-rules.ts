/**
 * First Profit PUBLIC SITE — pure constants + predicates for the
 * fp_public_sites registry/projection (first-profit repo plan
 * docs/plans/2026-08-03-002-feat-real-public-site-plan.md, Unit 1; migration
 * supabase/migrations/20260907120000_fp_public_sites.sql).
 *
 * This module is the TS side of the migration-parity contract: the DB CHECKs,
 * caps, docVersion gate, and reserved-handle seed must agree with the values
 * here, and the parity test
 * (__tests__/fp-public-sites-migration-parity.test.ts) parses the migration as
 * text to enforce it (no test DB in this suite). The Unit 2 endpoints consume
 * these as the server-side authority (the client receives rules/results, never
 * re-authors them); the first-profit SPA mirrors them for UX only.
 *
 * Charset agreement is the NESTING invariant (docs/solutions/best-practices/
 * broadening-a-shared-charset-...-2026-08-04.md):
 *
 *   producer (Unit 2 claim normalizer)  ⊆  DB CHECK  ===  this regex
 *
 * The acceptor pair (DB CHECK + HANDLE_PATTERN) must stay byte-for-byte equal.
 *
 * NO `server-only`, NO Next/Supabase imports — unit-testable in the node-only
 * harness and importable from scripts (sibling of fp-task-feedback-rules.ts).
 */

/** The claimable-handle shape: lowercase alphanumeric + hyphen, 3–20 chars.
 *  SOURCE string kept separately so the migration-parity test can compare it
 *  byte-for-byte against the SQL `~` pattern (which is also the argument
 *  validator inside fp_public_site()). */
export const HANDLE_PATTERN = "^[a-z0-9-]{3,20}$";

const HANDLE_RE = new RegExp(HANDLE_PATTERN);

/** Truncation cap on the public headline. The projection trigger TRUNCATES to
 *  this (never raises — a trigger RAISE would classify TERMINAL in the FP sync
 *  engine and drop the learner's snapshot); the table CHECK carries the same
 *  bound for service-role writers. */
export const SITE_HEADLINE_MAX_CHARS = 120;

/** Truncation cap on the public one-liner (same discipline as the headline). */
export const SITE_ONE_LINER_MAX_CHARS = 140;

/** Bound on the snapshotted first_name column (bounding discipline, like
 *  payer <= 80 on fp_ledger). Written by Unit 2 claim/publish only. */
export const SITE_FIRST_NAME_MAX_CHARS = 80;

/** The SaveDoc version the projection trigger parses. It gates on
 *  doc->>'docVersion' = SITE_DOC_VERSION_GATE and SKIPS anything else — a
 *  first-profit docVersion bump must consciously update the trigger (see the
 *  reciprocal comment at first-profit src/state/gameCore.ts DOC_VERSION). */
export const SITE_DOC_VERSION_GATE = "1";

/** States fp_public_site(handle) can express. Zero rows (unknown handle OR
 *  claimed-never-published — deliberately indistinguishable, enumeration
 *  resistance) is the third, implicit state. */
export const SITE_STATES = ["published", "offline"] as const;
export type SiteState = (typeof SITE_STATES)[number];

/** Handles no learner may ever claim. Must list EXACTLY the migration's
 *  fp_reserved_handles seed (parity test compares the sets); the vercel.json
 *  handle-rewrite exclusions in first-profit (Unit 3) derive from the `route`
 *  subset. Owner-curated; extend via a follow-up migration + this list in the
 *  same commit. */
export const RESERVED_HANDLES = [
  // routes (single-segment paths on firstprofit.school)
  "signup",
  "login",
  "logout",
  "verify",
  "app",
  "parent",
  "admin",
  "account",
  "settings",
  // serving infrastructure
  "api",
  "assets",
  "static",
  "public",
  "index",
  "home",
  "site",
  "sites",
  "www",
  "root",
  "status",
  "health",
  "robots",
  "sitemap",
  "favicon",
  // brand / ops / impersonation
  "firstprofit",
  "first-profit",
  "the120",
  "school",
  "about",
  "contact",
  "help",
  "support",
  "staff",
  "official",
  "security",
  "abuse",
  "terms",
  "privacy",
  "legal",
  "mail",
  "email",
  "blog",
  "docs",
  "news",
  "shop",
  "store",
] as const;

const RESERVED = new Set<string>(RESERVED_HANDLES);

/* -------------------------------------------------------------- predicates */

/** Normalize a candidate handle the way the DB read/claim paths do:
 *  trim, lowercase. (Validation is separate — see isValidHandle.)
 *
 *  NORMALIZATION PARITY (accepted, fails-closed): .trim() strips all Unicode
 *  whitespace; the SQL side's btrim strips SPACES only. Deliberate and safe:
 *  whitespace btrim leaves behind fails the charset regex and yields zero
 *  rows — the SQL side can only under-match, never leak a row this side
 *  would refuse. */
export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

/** Charset/length acceptance, byte-for-byte the DB CHECK. Callers should
 *  normalize first; this deliberately REJECTS un-normalized input (uppercase,
 *  whitespace) exactly as the CHECK would. */
export function isValidHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

/** True when the handle is in the reserved seed (callers normalize first). */
export function isReservedHandle(value: string): boolean {
  return RESERVED.has(value);
}

/* --------------------------------------------- executable extraction spec */

/** Result of extracting public-site content from a save doc.
 *  NULL = "absent / not extractable — do not touch the column" (skip
 *  sentinel); EMPTY STRING = a legitimate value that OVERWRITES (clearing a
 *  headline must propagate; the public renderer falls back to defaults). */
export interface SiteContent {
  headline: string | null;
  oneLiner: string | null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The activeIdea acceptor, byte-for-intent the SQL's: the value must be a
 *  JSON number whose canonical text form matches ^[0-9]{1,9}$ — rejecting
 *  non-numbers ("abc"), non-integers (1.5), negatives (-1: jsonb -1 means
 *  "last element" and must never project the last idea), and >9-digit values
 *  that would overflow the SQL ::integer cast. NOTE on exponent notation: a
 *  doc author writing `1e3` never reaches either acceptor as that literal —
 *  JSON.parse and Postgres jsonb both normalize it to 1000 first, which
 *  passes the regex and is then bounds-checked like any index. */
const ACTIVE_IDEA_RE = /^[0-9]{1,9}$/;

/**
 * THE SPEC LIVES HERE (the guardSaveDocUpdate precedent): the executable TS
 * mirror of the migration's fp_public_site_content(jsonb). The plpgsql is a
 * copy this suite cannot run; this function IS the behavior under test, and
 * the migration-parity test pins that the SQL implements the same structure
 * (typeof guards, acceptor regex, bounds check, truncation caps).
 *
 * Faithful to the SQL including: object-doc gate; per-step type guards
 * (ideas array, idea object, fields object, oneLiner string); the activeIdea
 * acceptor above with the < ideas.length bounds check; truncation to
 * SITE_HEADLINE_MAX_CHARS / SITE_ONE_LINER_MAX_CHARS. (Truncation counts
 * UTF-16 units here vs Postgres characters — divergent only beyond the BMP,
 * and only in where the clamp cuts, never whether it clamps.)
 *
 * The docVersion GATE is deliberately NOT here: it belongs to the projection
 * trigger (and to Unit 2's callers), exactly as in the SQL where the gate
 * lives in fp_public_sites_project_save, not the shared extraction.
 */
export function extractSiteContent(doc: unknown): SiteContent {
  let headline: string | null = null;
  let oneLiner: string | null = null;
  if (isJsonObject(doc)) {
    if (typeof doc.siteHeadline === "string") {
      headline = doc.siteHeadline.slice(0, SITE_HEADLINE_MAX_CHARS);
    }
    const ideas = doc.ideas;
    const active = doc.activeIdea;
    if (
      Array.isArray(ideas) &&
      typeof active === "number" &&
      ACTIVE_IDEA_RE.test(String(active)) &&
      active < ideas.length
    ) {
      const idea: unknown = ideas[active];
      if (isJsonObject(idea) && isJsonObject(idea.fields) && typeof idea.fields.oneLiner === "string") {
        oneLiner = idea.fields.oneLiner.slice(0, SITE_ONE_LINER_MAX_CHARS);
      }
    }
  }
  return { headline, oneLiner };
}
