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

/** Truncation cap on each product card's name (products projection —
 *  20260909120000_fp_site_products.sql; same clamp discipline). */
export const SITE_PRODUCT_NAME_MAX_CHARS = 60;

/** Cap on the products array length = first-profit MAX_IDEAS (src/state/
 *  gameCore.ts MAX_IDEAS = 5 — CREATE_IDEA refuses a sixth idea, so only a
 *  hand-crafted doc can exceed it). Extraction iterates the FIRST
 *  SITE_MAX_PRODUCTS ideas only; the table CHECK is the backstop. A
 *  first-profit MAX_IDEAS change must consciously update this and the
 *  migration together. */
export const SITE_MAX_PRODUCTS = 5;

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
  // The handoff sign-in entry point lives at /auth/enter (v3 Unit 6). The route
  // is multi-segment so first-profit's rewrite needs no change — but `auth` is
  // reserved anyway so no kid's public site can sit ONE SEGMENT ABOVE a sign-in
  // surface on the same origin. Seeded by
  // supabase/migrations/20260916120000_fp_reserved_handle_auth.sql.
  "auth",
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
  // marketing placeholder URLs: the first-profit Landing renders the literal
  // URLs firstprofit.school/your-name (hero mockup) and
  // firstprofit.school/their-name (steps copy) — neither may ever become a
  // real child's page (Unit 7; reserved before claiming is enabled anywhere).
  "your-name",
  "their-name",
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

/* ------------------------------------------------------------ site status */

export type SiteStatus = "none" | "claimed" | "published" | "offline";

export type SiteRowFlags = {
  published: boolean;
  operator_locked: boolean;
  first_published_at: string | null;
};

/**
 * The ONE status ladder every surface derives from (child self-read, parent
 * dashboard — the review's no-second-copy rule):
 *   no row                                → none
 *   visible (published AND NOT locked)    → published
 *   locked, or unpublished-after-publish  → offline (parent-unpublished and
 *     operator-locked are DELIBERATELY indistinguishable to the child)
 *   claimed, never published, not locked  → claimed
 */
export function deriveSiteStatus(row: SiteRowFlags | null): SiteStatus {
  if (!row) return "none";
  if (row.published && !row.operator_locked) return "published";
  if (row.operator_locked || row.first_published_at !== null) return "offline";
  return "claimed";
}

/* ---------------------------------------------------------------- blocklist */

/**
 * Kid-safety blocklist for PUBLIC strings (handle, headline, one-liner). The120
 * is the SOURCE OF TRUTH (the echo-the-server learning: the client screens for
 * UX only and never re-authors these rules), and since the Unit 2 review the
 * SQL extraction enforces the SAME list (fp_blocked_terms seed +
 * fp_public_text_blocked in 20260907120000_fp_public_sites.sql — parity test
 * pins seed ⟷ these arrays), so the projection trigger can never put a
 * blocked in-game edit on a live page.
 *
 * TWO MATCH CLASSES (both directions of the matcher problem):
 *   - SUBSTRING terms: long/unambiguous — matched as substrings of the FOLDED
 *     text (separator/symbol stripping defeats "f-u-c-k" / "f*u*c*k" dodges).
 *     Every term here must be one no innocent kid string contains (the
 *     scunthorpe class). Includes common masked spellings (fck, fuk) so
 *     "f*ck" (symbol swallowed by folding → "fck") is caught.
 *   - WORD terms: short/collision-prone (meth ⊂ method, retard ⊂ retardant,
 *     heroin ⊂ heroine) — matched only as WHOLE TOKENS of the lightly-folded
 *     text (NFKC + lowercase + format-char strip, tokenized on
 *     non-alphanumerics). "Our proven method for selling lemonade" passes;
 *     "meth" alone does not.
 *
 * SPACES ARE BOUNDARIES in the substring fold (round-2 review P1): symbols,
 * punctuation, and format chars are folded away WITHIN tokens, but whitespace
 * survives (collapsed to single spaces), so a blocked term can never match
 * ACROSS a word join — "Sushi Tempura" does not contain "shit", "Bass Hole
 * Lures" does not contain "asshole", "Scunthorpe Sweets" does not contain
 * "cunt". Multi-word terms match via their spaced phrase form ("kill
 * yourself") OR their joined form within one token ("killyourself",
 * "kill-your-self" → "killyourself").
 *
 * ACCEPTED RESIDUALS (documented, not defended): (a) a WORD term spelled with
 * separators ("m-e-t-h") tokenizes into single letters and is missed —
 * boundary information and separator-dodge resistance are mutually exclusive
 * per term, and the aggressive class covers the high-severity terms; (b)
 * homoglyph substitution outside NFKC's reach (e.g. Cyrillic а U+0430 for
 * Latin a) is NOT caught — NFKC does not confusable-fold; that class is
 * operator-takedown territory (fp-site-lock), not filter territory; (c) a
 * SUBSTRING term spelled with real SPACES ("f u c k") is missed — the price
 * of the space-boundary rule above, consistent with residual (a): spaces are
 * the one separator the fold must respect to avoid blanking innocent
 * cross-word joins.
 */
export const BLOCKED_SUBSTRING_TERMS = [
  "fuck",
  "fck",
  "fuk",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dickhead",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "slut",
  "porn",
  "kill yourself",
  "hitler",
  "nazi",
  "cocaine",
] as const;

export const BLOCKED_WORD_TERMS = [
  // cunt ⊂ scunthorpe — the namesake collision; boundary-aware like meth.
  "cunt",
  "kys",
  "meth",
  "retard",
  "heroin",
  "sexy",
  "nude",
  "naked",
] as const;

/** The full curated list (SQL-seed parity + the client mirror). */
export const PUBLIC_CONTENT_BLOCKLIST = [
  ...BLOCKED_SUBSTRING_TERMS,
  ...BLOCKED_WORD_TERMS,
] as const;

/**
 * Fold for SUBSTRING matching: NFKC (fullwidth/compatibility forms collapse
 * to ASCII shapes), lowercase, strip format/zero-width characters (\p{Cf}:
 * ZWSP, ZWJ, ...), strip symbols/punctuation WITHIN tokens ("f*u_c-k" →
 * "fuck") — but PRESERVE whitespace as token boundaries (runs collapse to a
 * single space), so a term can never match across a word join ("Sushi
 * Tempura" → "sushi tempura", which does NOT contain "shit"). SQL mirror:
 * fp_blocklist_fold (normalize(...,NFKC) + lower + non-alnum-non-space strip
 * + space collapse — see the divergence note there).
 */
export function foldForBlocklist(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A term's JOINED form (spaces removed after folding): the shape that may
 *  match only WITHIN one token of the folded text (it contains no space, so
 *  it structurally cannot span one). */
function joinedFold(value: string): string {
  return foldForBlocklist(value).replace(/ /g, "");
}

/** Light fold + tokenize for WORD matching: NFKC + lowercase + format-char
 *  strip, then split on runs of non-alphanumerics. Boundary info survives. */
function tokensForBlocklist(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True when the value trips either match class — see the module comment.
 *  Substring terms match as their spaced phrase ("kill yourself") or their
 *  joined form ("killyourself" — spaceless, so it can only land inside one
 *  token of the space-preserving fold, never across a word join). */
export function containsBlockedTerm(value: string): boolean {
  const folded = foldForBlocklist(value);
  if (
    BLOCKED_SUBSTRING_TERMS.some((term) => {
      const spaced = foldForBlocklist(term);
      const joined = joinedFold(term);
      return folded.includes(spaced) || folded.includes(joined);
    })
  ) {
    return true;
  }
  const tokens = new Set(tokensForBlocklist(value));
  return BLOCKED_WORD_TERMS.some((term) => tokens.has(term));
}

/**
 * Server-side ENFORCEMENT for public content strings (headline / one-liner) at
 * the claim backfill and every publish-time refresh: an offending string is
 * stored as EMPTY (the public renderer's default copy shows) — never stored
 * raw, never an error (a save-doc write can bypass the client entirely, R20
 * threat model). Client screening is UX; this is the gate.
 */
export function sanitizePublicText(value: string): string {
  return containsBlockedTerm(value) ? "" : value;
}

/* --------------------------------------------- executable extraction spec */

/**
 * One public product card (products projection, 20260909120000). THE RENDERER
 * CONTRACT — first-profit's public page consumes this element verbatim:
 *   n        — the idea's ORIGINAL 1-based position in doc.ideas (drives the
 *              "Product #N" numbering; fully-empty ideas are excluded from
 *              the array but keep their slot via n, so numbering never
 *              shifts).
 *   name     — fields.productName, blocklist-enforced (blocked → ''), then
 *              truncated to SITE_PRODUCT_NAME_MAX_CHARS.
 *   oneLiner — fields.oneLiner, blocklist-enforced (blocked → ''), then
 *              truncated to SITE_ONE_LINER_MAX_CHARS.
 */
export interface SiteProduct {
  n: number;
  name: string;
  oneLiner: string;
}

/** Result of extracting public-site content from a save doc.
 *  NULL = "absent / not extractable — do not touch the column" (skip
 *  sentinel); EMPTY STRING = a legitimate value that OVERWRITES (clearing a
 *  headline must propagate; the public renderer falls back to defaults).
 *  `products` follows the same discipline: NULL when doc.ideas is absent/not
 *  an array; EMPTY ARRAY is a legitimate overwrite (all ideas emptied →
 *  live cards clear). */
export interface SiteContent {
  headline: string | null;
  oneLiner: string | null;
  products: SiteProduct[] | null;
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
 * acceptor above with the < ideas.length bounds check; the BLOCKLIST step
 * (sanitizePublicText on the RAW value — blocked → '', mirroring
 * fp_clamp_public_text, so a term straddling the cap cannot slip through as
 * its clamped prefix); then truncation to SITE_HEADLINE_MAX_CHARS /
 * SITE_ONE_LINER_MAX_CHARS. (Truncation counts UTF-16 units here vs Postgres
 * characters — divergent only beyond the BMP, and only in where the clamp
 * cuts, never whether it clamps.)
 *
 * The docVersion GATE is deliberately NOT here: it belongs to the projection
 * trigger (and to Unit 2's callers), exactly as in the SQL where the gate
 * lives in fp_public_sites_project_save, not the shared extraction.
 */
export function extractSiteContent(doc: unknown): SiteContent {
  let headline: string | null = null;
  let oneLiner: string | null = null;
  let products: SiteProduct[] | null = null;
  if (isJsonObject(doc)) {
    if (typeof doc.siteHeadline === "string") {
      headline = sanitizePublicText(doc.siteHeadline).slice(0, SITE_HEADLINE_MAX_CHARS);
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
        oneLiner = sanitizePublicText(idea.fields.oneLiner).slice(0, SITE_ONE_LINER_MAX_CHARS);
      }
    }
    // Products v2 (mirrors the SQL loop): EVERY idea, first SITE_MAX_PRODUCTS
    // only, independent of activeIdea. Per-idea defensiveness: a non-object
    // element or non-object/absent `fields` yields '' leaves (→ excluded),
    // never a throw. Fully-empty ideas are EXCLUDED; `n` (1-based position)
    // preserves the Product #N numbering.
    if (Array.isArray(ideas)) {
      products = [];
      const count = Math.min(ideas.length, SITE_MAX_PRODUCTS);
      for (let i = 0; i < count; i++) {
        const idea: unknown = ideas[i];
        let name = "";
        let productLiner = "";
        if (isJsonObject(idea) && isJsonObject(idea.fields)) {
          if (typeof idea.fields.productName === "string") {
            name = sanitizePublicText(idea.fields.productName).slice(0, SITE_PRODUCT_NAME_MAX_CHARS);
          }
          if (typeof idea.fields.oneLiner === "string") {
            productLiner = sanitizePublicText(idea.fields.oneLiner).slice(0, SITE_ONE_LINER_MAX_CHARS);
          }
        }
        if (name !== "" || productLiner !== "") {
          products.push({ n: i + 1, name, oneLiner: productLiner });
        }
      }
    }
  }
  return { headline, oneLiner, products };
}
