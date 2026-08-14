/**
 * Pure decision rules for GET /api/fp/parent/roster — the PARENT-ONLY roster +
 * First Profit progress feed behind the fpv04 parent dashboard. No Next, no
 * Supabase — only decisions, per the house pure-module convention.
 *
 * It is the PARENT analogue of ../../progress/progress-rules.ts (the STAFF
 * cohort feed), and a deliberate mirror of it wherever the two share a concern.
 * Where they differ, the difference is commented here.
 *
 * ── What is REUSED rather than re-declared ──
 * The save-doc WALK is progress-rules' `walkSaveDoc`, imported outright. It is
 * the fail-closed, total, bounded reader of `fp_player_saves.doc` (entry caps,
 * key-length caps, the future-stamp clamp, `truncated` / `docUnreadable`), and
 * a second copy of that reasoning is exactly the drift this repo has already
 * paid for once. Its `WalkedIdea` / `WalkedBusiness` types are the wire shape
 * here, unchanged.
 *
 * ── What is deliberately NOT reused: the task-id FILTER ──
 * The staff feed filters every completion map to an explicit caller-supplied
 * list of task ids, because the Watchtower is a criterion-at-a-time flow board.
 * This door sends the maps UNFILTERED. The parent dashboard renders "12 of 25
 * done" per kid, and the FP client derives n and total from its OWN curriculum
 * data (src/data/pathContent.generated.ts) — so the server would have to hold
 * the whole task-id vocabulary just to be asked for it, which is precisely the
 * domain knowledge progress-rules is organised around never having. The rule
 * carries over intact: THE SERVER SENDS THE MAPS RAW, THE CLIENT OWNS EVERY
 * SEMANTIC. No totals, no percentages, no notion of a phase, are computed here.
 *
 * That does mean the per-child payload is bigger than the staff feed's, so the
 * bounds that mattered there matter more here — see
 * PARENT_ROSTER_MAX_RESPONSE_BYTES.
 *
 * ── THE SCOPE IS THE SECURITY BOUNDARY ──
 * There is no id parameter on this route at ALL. Children are resolved by
 * `WHERE parent_id = <the AUTHENTICATED parent's id>` in the query itself,
 * service-role side, from the id `auth.getUser()` returned — never from
 * anything the client said. Nothing in this module can widen that: it is handed
 * rows and shapes them, and the route is the only place the filter lives.
 * (../../parent-login/route.ts does the same service-role re-resolve for its
 * parent gate; this route repeats that gate before reading any roster.)
 *
 * ── Refusal posture ──
 * ONE refusal, the parent door's own bytes. `shapeParentRosterRefusal` takes a
 * reason (for logs and tests) and deliberately IGNORES it: every refusal is the
 * same 401 with a byte-identical body, re-used verbatim from
 * ../../parent-login/parent-login-rules so the two halves of the parent SPA's
 * session lifecycle speak with ONE voice. 403 exists only for a disallowed
 * Origin.
 *
 * ── Never-log discipline (R3) ──
 * A child's name, `fp_username`, and the bearer token are all child/parent data
 * and NEVER reach a log line. Nothing in this module throws, and no message it
 * could produce embeds a value from its input. The walk it delegates to is
 * fail-CLOSED and total: hostile or half-written jsonb degrades to empty
 * structures, never an exception the route would have to describe.
 */

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../parent-login/parent-login-rules";
import {
  walkSaveDoc,
  type ProgressProfileRowLike,
  type ProgressSaveRowLike,
  type ProgressWalkNote,
  type WalkedBusiness,
  type WalkedIdea,
  type WalkedSaveDoc,
} from "../../progress/progress-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";
import { ageBandFromGrade, resolveChildGrade } from "../../grade/grade-rules";
import type { ChildAgeBand } from "../../signup/signup-rules";

/* --------------------------------------------------------- refusal shaping */

export type ParentRosterRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "not_parent"
  | "rate_limited"
  /**
   * A bounded read matched more rows than its cap (see
   * PARENT_ROSTER_MAX_CHILDREN), or the shaped body exceeded
   * PARENT_ROSTER_MAX_RESPONSE_BYTES.
   *
   * Deliberately NOT split off into a 400 class the way the staff feed splits
   * capacity out. That carve-out exists because the Watchtower reads a 401 as
   * "not staff" for the WHOLE shell, so a capacity breach would sign staff out
   * of every tab over a row count. It does not transfer: a parent's roster is
   * bounded by their own account — reaching this cap means something is wrong
   * with the DATA, not with the family — and adding a second status to a
   * hostile-facing cross-origin door is new surface for a case no real parent
   * can reach. It is DETERMINISTIC, so like the staff feed's capacity breach it
   * is never refunded a rate-limit strike.
   */
  | "too_many_rows"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login answers. Same bytes on purpose: the dashboard's fetch
 * layer sees one refusal shape whether the session expired, was never a
 * parent's, or hit the limiter, and no probe of this URL learns anything a
 * failed sign-in would not already have told them.
 */
export const PARENT_ROSTER_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const PARENT_ROSTER_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
/**
 * THE WIRE SHAPE, as a key list — the twin-pin precedent
 * (`FP_PARENT_SESSION_BODY_KEYS`, `FP_CHILD_MINT_BODY_KEYS`). The First Profit
 * SPA declares its own `RosterChild` interface against these bytes and pins
 * the SAME list in src/lib/__tests__/parentApi.test.ts, so a rename or removal
 * here breaks a test on BOTH sides of the deploy rather than silently
 * mis-rendering a parent's dashboard.
 */
export const PARENT_ROSTER_CHILD_KEYS = [
  "id",
  "firstName",
  "lastName",
  "fpUsername",
  "truncated",
  "docUnreadable",
  "ideas",
  "businesses",
  // ── fpv04 U8b: the three facts the SPA's parent dashboard needs in order to
  // offer PHOTO PERMISSION and TAKE THE PAGE OFFLINE. APPENDED, never
  // interleaved — field order is observable output.
  "ageBand",
  "photoConsentOpen",
  "site",
] as const;

export function shapeParentRosterRefusal(
  reason: ParentRosterRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PARENT_ROSTER_REFUSAL_STATUS, body: PARENT_ROSTER_REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces and budgets — never shared with the parent LOGIN
 * buckets and never with the staff feed's. A parent who has just been throttled
 * signing in must not find their dashboard dark for the same 15 minutes, and a
 * dashboard refresh loop must not lock them out of signing in.
 *
 * SIZING: the dashboard fetches the roster once per load, plus a Refresh and
 * the odd retry. 120 per (ip,parent) per 15 minutes is roughly a refresh every
 * 7 seconds sustained — far past any human — while the per-IP aggregate is
 * DOUBLE that, so a family on one NAT with several parents' tabs open fits and
 * a scripted reader is still capped. Both are PINNED by test so any future
 * tightening is a deliberate edit rather than a drive-by.
 */
export const PARENT_ROSTER_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 120 };
export const PARENT_ROSTER_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 240 };

/**
 * Composite keys with BOTH segments escaped before the `:` join — an IPv6 ip or
 * a `:` in a forged sub must never alias two distinct (ip,user) pairs onto one
 * bucket (see docs/solutions/security-issues/
 * composite-rate-limit-key-string-join-collides-*.md).
 *
 * `encodeRateLimitSegment` rather than a bare `encodeURIComponent`: the user
 * segment is an attacker-supplied JWT `sub`, and a LONE SURROGATE in it makes
 * encodeURIComponent THROW — which on this route would land BEFORE either
 * strike is recorded, bypassing throttling entirely. This function is total.
 */
export function deriveParentRosterRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-roster:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-roster-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------- read bounds */

/**
 * The bound on ONE parent's roster read, and on each of the two reads that hang
 * off it (profiles by child id, saves by profile id).
 *
 * Why a flat cap rather than the staff feed's keyset PAGING: that route reads
 * the WHOLE cohort, which is unbounded and already thousands of rows in a
 * plausible future, and PostgREST silently caps an unranged select at 1000 rows
 * with `error: null` and no truncation signal (docs/solutions/
 * integration-issues/postgrest-max-rows-1000-silently-truncates-unranged-select-
 * paginate-and-refuse-2026-07-24.md). A PARENT's children are bounded by their
 * own account — the real number is 1 to 4 — so 100 is two orders of magnitude
 * of headroom AND sits far under any plausible server `max-rows`, which means
 * the silent-truncation hazard cannot fire at all: the client `.limit()` is
 * always the binding one.
 *
 * The reads ask for `cap + 1` and REFUSE past the cap rather than serving the
 * first 100, for the same reason the staff feed refuses: a truncated roster
 * would not look broken, it would look like a smaller family, and the missing
 * child would read as "not enrolled" rather than "not loaded".
 */
export const PARENT_ROSTER_MAX_CHILDREN = 100;

/**
 * The cap on any single Supabase round trip this route makes. Nothing in the
 * Supabase client sets a fetch timeout, so an unwrapped call can hang until the
 * platform's own ceiling. Deliberately the same 8 s as the staff feed's
 * PROGRESS_READ_TIMEOUT_MS — a parent refreshing on hotel wifi is the same
 * waiting human — but its OWN constant, because nothing about this route should
 * change when that one is retuned.
 */
export const PARENT_ROSTER_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, as a duration from the first line of the
 * handler. Per-call timeouts do NOT bound their sum: this route makes up to 4
 * bounded calls (token verify, parent gate, children, profiles, saves), and
 * 5 × 8 s would blow a 60 s `maxDuration` with every individual call inside its
 * own budget — at which point the platform answers with a CORS-LESS error page,
 * a different response shape and therefore an oracle. The route takes ONE
 * deadline at entry and hands each call whatever remains, so the last word is
 * always OUR refusal.
 */
export const PARENT_ROSTER_TOTAL_BUDGET_MS = 30_000;

/**
 * The AGGREGATE response budget, in bytes of serialized body.
 *
 * The walk's per-child caps bound one child; nothing bounds the roster. They
 * matter MORE here than on the staff feed, because this door sends the
 * completion maps UNFILTERED (module header) — a hostile save doc can legally
 * carry 50 ideas × 500 map keys of up to 64 characters, four maps deep, under
 * the DB's own `pg_column_size(doc) <= 262144` CHECK, which measures the
 * COMPRESSED size. The platform's answer to an oversized response is a 500
 * emitted WITHOUT this route's CORS headers; refusing ourselves keeps every
 * failure in one voice.
 *
 * 4 MB sits under the 4.5 MB serverless response limit with room for headers,
 * and three orders of magnitude above a real family's payload.
 */
export const PARENT_ROSTER_MAX_RESPONSE_BYTES = 4_000_000;

/* -------------------------------------------------------------- row inputs */

/**
 * Only the columns the shape actually reads. No `photo`, no `email`, no
 * `applicant_state`: this endpoint has no business reading a column nothing on
 * the wire consumes.
 *
 * ⚠ `birth_year` / `grade` WERE on that never-read list, and are here now
 * (fpv04 U8b) for exactly one reason: `ageBand`. The photo-consent GRANT door
 * writes `fp_parental_consent.child_age_band`, a NOT NULL column of a legal
 * evidence record, and the First Profit SPA holds no age for a child anywhere —
 * so it would have to INVENT one, which on an evidence record is the wrong
 * thing. The band is derived server-side here and NEITHER RAW COLUMN GOES ON
 * THE WIRE: a coarse three-value band is what the affordance needs, and a birth
 * year is not.
 */
export type RosterChildRowLike = {
  id: string;
  first_name?: unknown;
  last_name?: unknown;
  fp_username?: unknown;
  /** Text column; `''` is the unset sentinel. Consumed ONLY by
   *  `resolveChildGrade` → `ageBandFromGrade`, never serialized. */
  birth_year?: unknown;
  /** The stored fallback when no birth year exists. Same rule: never
   *  serialized. */
  grade?: unknown;
};

/** Re-exported so the route (and its tests) import ONE vocabulary. Identical to
 *  the staff feed's — the join is the same join. */
export type RosterProfileRowLike = ProgressProfileRowLike;
export type RosterSaveRowLike = ProgressSaveRowLike;
export type RosterWalkNote = ProgressWalkNote;

/* ------------------------------------------------------------ wire contract */

/**
 * One child as the PARENT client receives them.
 *
 * `ideas` / `businesses` are `WalkedIdea` / `WalkedBusiness` VERBATIM — the
 * completion maps exactly as `walkSaveDoc` narrowed them, unfiltered, plus the
 * pre-computed recency numbers and `recencyClamped`. Read those types for what
 * each field means and does not mean; nothing is re-documented here, so the two
 * doors can never drift into two descriptions of one number.
 *
 * Field ORDER is observable output: do not reorder.
 */
export type ParentRosterChild = {
  /** `children.id`. The client's stable key for a card, and the id it would use
   *  for any future per-child call. */
  id: string;
  /** `children.first_name` / `children.last_name` — parent/staff-authoritative
   *  roster values, passed through exactly as stored (never trimmed: they are
   *  identity values the parent typed). `""` when the column is blank, which is
   *  its schema default. */
  firstName: string;
  lastName: string;
  /** `children.fp_username` — the name the kid signs into First Profit with, so
   *  the parent can help them log in. Server-managed and only set at
   *  provisioning, which is why its presence IS the enrolled-in-FP filter. */
  fpUsername: string;
  /** A walk bound fired somewhere in THIS CHILD'S doc — see
   *  `ProgressChild.truncated` for what the flag does and does not mean. */
  truncated: boolean;
  /** A save row EXISTS but its doc could not be read (not an object, or a
   *  docVersion this build does not understand). Distinguishes "doc not
   *  loadable" — the kid also sees an empty game — from "never started" (no save
   *  row at all), which would otherwise be indistinguishable empty rows. */
  docUnreadable: boolean;
  ideas: WalkedIdea[];
  businesses: WalkedBusiness[];
  /**
   * The consent age band this child's record would be written with, derived
   * server-side from `birth_year`/`grade` (see `RosterChildRowLike`). `null`
   * when NO age signal exists — the SPA then offers no grant affordance rather
   * than guessing a band onto a legal evidence record.
   */
  ageBand: ChildAgeBand | null;
  /**
   * Is photo/cover permission currently OPEN for this child?
   *
   * ⚠ `null` IS NOT "CLOSED". It means the consent read FAILED, and the SPA
   * must then render NEITHER affordance — offering "give permission" to a
   * family who already consented, or "withdraw" to one who never did, are both
   * worse than offering nothing until the next load. Same three-state contract
   * the120's own `photoAffordance` consumes.
   */
  photoConsentOpen: boolean | null;
  /**
   * This child's public First Profit page. `null` means the SITE READ FAILED —
   * again not "no page": the SPA renders no take-offline control on null. A
   * SUCCESSFUL read for a child with no page answers
   * `{handle: null, published: false}`.
   *
   * `published` is the DERIVED truth (`deriveSiteStatus` === "published"), not
   * the raw column: an operator lock keeps a page offline whatever `published`
   * says, and this field must mean "a stranger can see it".
   */
  site: ParentRosterSite | null;
};

/**
 * The public page as the parent client receives it.
 *
 * ⚠ `locked` IS NOT REDUNDANT WITH `published`. The status ladder deliberately
 * folds an OPERATOR takedown and a PARENT takedown into the same `offline`,
 * and the parent is allowed to know which — because only one of them is theirs
 * to undo. Without this field a locked page reads as "offline", the client
 * offers "put it back online", the write succeeds, and NOTHING CHANGES,
 * because the lock wins. the120's own UI refuses that button for exactly this
 * reason; the field is what lets a second surface refuse it too.
 *
 * ⚠ `handle === null` MEANS THERE IS NO PAGE AT ALL, and is a real answer
 * (distinct from the whole field being null, which means the read failed).
 * A client must gate its controls on the handle: offering "put their page
 * back online" to a child who has never had one earns a refusal the parent
 * cannot act on.
 */
export type ParentRosterSite = {
  handle: string | null;
  published: boolean;
  locked: boolean;
};

/**
 * The two side facts, each nullable on its own (fpv04 U8b).
 *
 * ⚠ NULL MEANS "THE READ FAILED", AND IT MUST NOT COLLAPSE INTO A NEGATIVE.
 * "we could not find out whether this parent gave photo permission" and "this
 * parent did not give photo permission" are different sentences, and only one
 * of them may put a withdraw button on a screen. Keeping them separate here is
 * why a site-table outage degrades ONE FIELD instead of failing the roster: a
 * parent must still see their kids' progress when the site table is down.
 */
export type RosterExtras = {
  /** Child ids with photo permission currently OPEN, or null if the read
   *  failed. Membership is only meaningful when the set exists. */
  consentOpen?: ReadonlySet<string> | null;
  /** child id → their public page, or null if the read failed. A present map
   *  MISSING a child means that child has no page. */
  sitesByChildId?: ReadonlyMap<string, ParentRosterSite> | null;
};

/* ------------------------------------------------------------ row shaping */

/**
 * Roster rows → profiles by child_id → saves by profile_id → the wire contract.
 * The staff feed's `shapeProgress` join, minus the task-id filter (module
 * header) and plus the child's name and id.
 *
 * ⚠ THIS FUNCTION DOES NOT AUTHORIZE ANYTHING. It shapes whatever children it
 * is handed. The parent scoping lives in the route's QUERY
 * (`.eq("parent_id", <authenticated id>)`) and nowhere else — do not add a
 * parent id parameter here in the belief that it is a second gate, because a
 * caller that forgot the `.eq` would then look gated while reading the school.
 *
 * A child with no `fp_username` is SKIPPED (the route's query already excludes
 * them; this is the fail-closed second half). A child with no profile row or no
 * save row is PRESENT with empty ideas/businesses and `docUnreadable: false` —
 * that is the "never signed in" signal, and dropping the row would silently
 * delete a kid from their own parent's dashboard.
 *
 * `now` is the clamp ceiling for every stamp in every doc, threaded from a
 * SINGLE `new Date()` at the route boundary — one clock for the whole roster,
 * so two siblings can never be clamped against different instants.
 */
export function shapeParentRoster(
  children: readonly RosterChildRowLike[],
  profiles: readonly RosterProfileRowLike[],
  saves: readonly RosterSaveRowLike[],
  now: Date,
  /** Optional collector for operator-facing notes about abnormal docs, keyed by
   *  `profile_id` (never the username — R3). APPENDED to, never read, so this
   *  function stays pure; the route owns whether any of it is worth a log line. */
  walkNotes?: RosterWalkNote[],
  /**
   * The two SIDE FACTS (fpv04 U8b), each independently nullable because each
   * comes from a read that may fail on its own. OMITTING this argument means
   * BOTH failed, which is the fail-closed default: a caller that forgets it
   * gets "render neither affordance", never a confident wrong answer.
   *
   * ⚠ THEY ARE HANDED IN, NOT FETCHED. This function shapes; the route reads.
   * Same rule as the parent scoping — see the ⚠ above.
   */
  extras?: RosterExtras
): ParentRosterChild[] {
  // First row wins on duplicates: the schema is one profile per child
  // (child_id unique) and one save per profile (profile_id PK), so this is
  // unreachable — and inventing a merge rule here would hide a data bug behind
  // a plausible-looking card.
  const profileByChildId = new Map<string, RosterProfileRowLike>();
  for (const p of profiles) if (!profileByChildId.has(p.child_id)) profileByChildId.set(p.child_id, p);

  const saveByProfileId = new Map<string, RosterSaveRowLike>();
  for (const s of saves) if (!saveByProfileId.has(s.profile_id)) saveByProfileId.set(s.profile_id, s);

  const out: ParentRosterChild[] = [];
  for (const child of children) {
    if (typeof child.fp_username !== "string" || child.fp_username.length === 0) continue;
    const profile = profileByChildId.get(child.id);
    const save = profile ? saveByProfileId.get(profile.id) : undefined;
    const walked: WalkedSaveDoc = save
      ? walkSaveDoc(save.doc, now)
      : { ideas: [], businesses: [], truncated: false, docUnreadable: false };
    if (walkNotes && save && (walked.truncated || walked.docUnreadable)) {
      walkNotes.push({
        profileId: save.profile_id,
        truncated: walked.truncated,
        docUnreadable: walked.docUnreadable,
      });
    }
    out.push({
      id: child.id,
      firstName: typeof child.first_name === "string" ? child.first_name : "",
      lastName: typeof child.last_name === "string" ? child.last_name : "",
      fpUsername: child.fp_username,
      truncated: walked.truncated,
      docUnreadable: walked.docUnreadable,
      ideas: walked.ideas,
      businesses: walked.businesses,
      // Derived at READ TIME from birth_year, falling back to the stored grade
      // (R9: the value never goes stale across school years) — the SAME
      // `resolveChildGrade` the login and handoff doors use.
      // The SAME derivation the consent door writes with — the stored grade
      // alone, never `birth_year` (which the CHILD can set through
      // /api/fp/grade). This field decides whether a client OFFERS the grant,
      // so if it disagreed with what the door would record, the offer would be
      // made on one basis and the evidence written on another.
      ageBand: ageBandFromGrade(typeof child.grade === "number" ? child.grade : null),
      // Membership answers only when the SET EXISTS. A null read is null per
      // child — never silently demoted to `false`.
      photoConsentOpen: extras?.consentOpen ? extras.consentOpen.has(child.id) : null,
      // Likewise: a null sites map is a failed read; a present map that simply
      // lacks this child means the child has no page, which is a real answer.
      site: extras?.sitesByChildId
        ? extras.sitesByChildId.get(child.id) ?? { handle: null, published: false, locked: false }
        : null,
    });
  }
  return out;
}
