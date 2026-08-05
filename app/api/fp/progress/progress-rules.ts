/**
 * Pure decision rules for GET /api/fp/progress — the STAFF-ONLY cohort progress
 * feed behind the Watchtower dashboard (first-profit repo,
 * docs/plans/2026-08-05-001-feat-watchtower-staff-progress-plan.md, Unit 1). It
 * walks each child's fp_player_saves doc server-side and projects the per-idea /
 * per-business completion maps the staff SPA renders. No Next, no Supabase —
 * only decisions, per the house pure-module convention (../suggestions/
 * suggestions-rules.ts is the direct sibling precedent and this module is a
 * deliberate file-for-file mirror of it; the ROUTE reuses login-rules'
 * origin/IP contract and grade-rules' bearer/sub helpers rather than
 * duplicating them, while THIS module imports grade-rules' resolveChildGrade
 * directly — see the band section).
 *
 * ── The staff gate, stated once ──
 * Identical posture to the suggestions endpoint: staff ARE Supabase auth users
 * in the SHARED project, so the route verifies a Bearer token with
 * auth.getUser() and then requires BOTH halves, in this order:
 *   1. JWT claim: app_metadata.role in the allowed set (server-set by
 *      scripts/seed-staff.ts via the admin API; a client can never write
 *      app_metadata), and
 *   2. staff row: public.staff has the user's id with is_active AND a role in
 *      the allowed set (revocation = flip is_active).
 * A genuine CHILD session fails the claim half and is refused with the SAME
 * byte-identical 401 as a bad token — a child must not be able to learn that
 * this endpoint exists.
 *
 * ── Why PROGRESS_ALLOWED_STAFF_ROLES is its OWN constant (R2) ──
 * The requirement is that this endpoint's authorization is DELIBERATELY
 * RE-DERIVED rather than inherited: a future widening of the suggestions
 * triage vocabulary must not silently hand out the whole cohort's progress.
 * So the list is declared here, with its own parity test against the crm_core
 * migration's CHECK. Its MEMBERSHIP is identical to suggestions' today
 * (`['admin']` is the entire production vocabulary) and that sameness is
 * intentional too: the staff SPA reads 401 as "not staff" for the whole shell,
 * so a per-endpoint role divergence would force a per-tab "no access" state and
 * break the shared signout-on-refusal logic. Same membership, separate
 * decision — if the sets ever genuinely diverge, the client work is a per-tab
 * refusal state, deferred until real divergence.
 *
 * ── Role vocabulary ──
 * The staff table's CHECK is `role in ('admin')` (20260713110000_crm_core.sql)
 * and seed-staff.ts stamps both the claim and the row 'admin'. When tiers are
 * minted (a CHECK widening + seed changes), add them HERE and the parity test
 * against the crm_core CHECK will hold the two lists together.
 *
 * ── Refusal posture ──
 * ONE refusal (child-gateway discipline): `shapeProgressRefusal` takes a reason
 * (for logs and tests) and deliberately IGNORES it — every refusal is the same
 * 401 with a byte-identical body, minted once at module load from the login
 * surface's copy. One voice, no oracle. 403 exists only for a disallowed
 * Origin.
 *
 * ── Never-log discipline (R3) ──
 * Usernames, idea labels, and tokens are child data. Nothing in this module
 * throws — and no message it could ever produce embeds a value from its input.
 * The walk below is fail-CLOSED and total: hostile or half-written jsonb
 * degrades to empty structures, never an exception the route would have to
 * describe.
 *
 * ── Bounded output (the amplification fuse) ──
 * `fp_player_saves.doc` is capped by `pg_column_size(doc) <= 262144`, which
 * measures the COMPRESSED size. A highly compressible doc — thousands of `{}`
 * idea entries — therefore fits under the DB cap while expanding, MEASURED, by
 * more than 30x once every entry is projected into the full wire shape. One
 * such child would blow the response past the platform's limit and 500 the
 * dashboard for the ENTIRE cohort. So every unbounded dimension is capped
 * (ideas, businesses, map entries, label length) and the caps TRUNCATE rather
 * than throw — degrade-never-throw, with `truncated: true` on the affected
 * child so the loss is visible to staff instead of silent. Truncation never
 * disturbs the original-index invariant below.
 *
 * ── Response contract (documented for the FP staff client in route.ts) ──
 * 200 {ok:true, children:[{
 *        username, band, truncated, docUnreadable,
 *        ideas:[{index, id, label, done, doneAt, doneByTask, doneAtByTask}],
 *        businesses:[{id, ideaId, archived, doneByTask, doneAtByTask}]
 *      }]}
 * The server sends the four per-idea maps essentially RAW (defensively
 * narrowed; keys untouched EXCEPT for the prototype-shadowing exclusion
 * documented at `isUnsafeMapKey`) and the two per-business maps; the CLIENT
 * owns all semantics — legacy-key remapping, the union rules, and every view
 * computation. The server stays free of task-id domain knowledge on purpose
 * (plan: "Server sends raw maps, client owns semantics").
 */

import type { Band } from "@/app/fp/content/types";
import { bandForGrade } from "@/app/fp/lib/progress-core";
// Deliberate CROSS-ENDPOINT dependency, not a layering accident: the grade
// route owns the birth-year → grade derivation the login route already reads
// with, so the dashboard's band must come from that one authority rather than a
// second copy that could drift a school year out of step.
import { resolveChildGrade } from "@/app/api/fp/grade/grade-rules";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import {
  encodeRateLimitSegment,
  type RateLimitConfig,
} from "@/app/fp/lib/rate-limit-rules";

/* -------------------------------------------------------------- staff roles */

/**
 * staff.role values allowed through this endpoint. Its own constant with its
 * own parity test — see the module header for WHY it is separate from
 * SUGGESTIONS_ALLOWED_STAFF_ROLES despite being identical today.
 */
export const PROGRESS_ALLOWED_STAFF_ROLES = ["admin"] as const;

export function isAllowedProgressStaffRole(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (PROGRESS_ALLOWED_STAFF_ROLES as readonly string[]).includes(value)
  );
}

/* --------------------------------------------------------- refusal shaping */

export type ProgressRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "not_staff"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login/grade/suggestions surfaces (one
// voice — a child or an attacker probing this staff URL sees exactly what a bad
// login shows them, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const PROGRESS_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeProgressRefusal(
  reason: ProgressRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PROGRESS_REFUSAL_STATUS, body: REFUSAL_BODY };
}

/* ---------------------------------------------------------- rate limiting */

/**
 * Staff dashboard budgets in this route's OWN namespace (never shared with the
 * child surfaces, and never shared with the suggestions buckets even though the
 * numbers match). Sizing rationale, from the plan: the normal daily check is
 * TWO authenticated GETs per /staff visit (suggestions + progress) plus at most
 * one retry — the suggestions-level budgets leave an order of magnitude of
 * headroom, while the per-IP aggregate still bounds a stolen-token or scripted
 * reader. The limiter doubles as this endpoint's server-side cooldown: the
 * client polls on no interval, only a manual Refresh button.
 *
 * Both constants are PINNED by the unit test so any future tightening is a
 * deliberate edit rather than a drive-by.
 */
export const PROGRESS_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 60 };
export const PROGRESS_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 120 };

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
export function deriveProgressRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-progress:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-progress-ip:${ipEnc}`,
  };
}

/* --------------------------------------------------------------------- caps */

/**
 * The doc SHAPE this walk understands, mirroring DOC_VERSION in the
 * first-profit repo's src/state/gameCore.ts. The client's `fromSaveDoc`
 * REFUSES any other version outright ("unknown-version") and boots the kid into
 * an EMPTY game — so a doc this walk cannot read is a doc the child cannot read
 * either. Reading it anyway would show staff a full progress row for a kid
 * staring at a blank factory floor, which is the precise opposite of what this
 * dashboard is for. (The save-doc guard passes such a write through untouched,
 * so a child CAN put one in the table.)
 */
export const PROGRESS_DOC_VERSION = 1;

/**
 * Per-child output bounds. Generous against reality and tight against abuse:
 * the FP client caps a kid at MAX_IDEAS = 5 and the one-active-business
 * invariant means a handful of business records ever, so 50 of each is roughly
 * an order of magnitude of headroom for a legitimate doc while bounding the
 * compressible-jsonb amplification described in the module header.
 */
export const PROGRESS_IDEAS_CAP = 50;
export const PROGRESS_BUSINESSES_CAP = 50;

/**
 * Per-map entry bound. The full path is 25 criteria of a handful of tasks each
 * — well under 200 entries for a completed kid — so 500 cannot be reached
 * honestly, while a doc packing thousands of one-character keys into a map is
 * bounded here rather than in the response body.
 */
export const PROGRESS_MAP_ENTRIES_CAP = 500;

/** Idea labels are a product name or a one-liner. Truncated, never dropped. */
export const PROGRESS_LABEL_MAX_CHARS = 200;

/**
 * The largest epoch-ms value `new Date()` can represent. A stamp past it is
 * doubly poisonous: `new Date(x).toISOString()` THROWS RangeError in the
 * client's renderer, and a max-of-stamps recency makes the child look
 * permanently fresh — silently removing them from the stuck list, which is the
 * exact failure this dashboard exists to prevent. Dropped, so the completion
 * degrades to "done at an unknown time" — a state the client already models.
 */
export const PROGRESS_MAX_TIMESTAMP_MS = 8.64e15;

/* ------------------------------------------------------------ wire contract */

/** One idea's raw completion state, as the staff client receives it. */
export type ProgressIdea = {
  /**
   * The idea's ORIGINAL position in `doc.ideas` — NOT its position in this
   * array, and NOT renumbered by truncation. The original index is
   * load-bearing: the client mints `legacy-idea-{index}` for id-less ideas
   * exactly as the kid's own client did, and a COMPACTED index space would mint
   * different ids and break `Business.ideaId` links.
   */
  index: number;
  id: string | null;
  /** fields.productName → fields.oneLiner → null, trimmed, truncated to
   *  PROGRESS_LABEL_MAX_CHARS. */
  label: string | null;
  /** Legacy `${stepId}#${index}` keyed maps. */
  done: Record<string, boolean>;
  doneAt: Record<string, number>;
  /** Stable task-id keyed maps. */
  doneByTask: Record<string, boolean>;
  doneAtByTask: Record<string, number>;
};

/** One business record. Stable-id maps only — by design there are no legacy
 *  maps on a Business (the record postdates the stable-id migration). */
export type ProgressBusiness = {
  id: string;
  /**
   * The linked idea's id. NULL only when the doc omits it, or carries a
   * non-string / empty value. A well-formed but DANGLING id (no idea in this
   * doc has it — e.g. the idea was deleted) passes through UNRESOLVED, exactly
   * as written: the client must handle the lookup miss and render an "unlinked"
   * row. Resolving it to null here would destroy the only evidence of which
   * idea the business came from.
   */
  ideaId: string | null;
  /**
   * True only for an explicit `archived: true`. Without it the client cannot
   * tell an abandoned business from the active one, and the plan's "next task
   * from the most recent completion" rule would happily point staff at an
   * ARCHIVED record.
   */
  archived: boolean;
  doneByTask: Record<string, boolean>;
  doneAtByTask: Record<string, number>;
};

export type ProgressChild = {
  /** children.fp_username. Rendered by staff, NEVER logged. */
  username: string;
  /** resolveChildGrade (birth year WINS over the stored grade) → bandForGrade.
   *  Null when neither source resolves — this module refuses to guess. */
  band: Band | null;
  /** A cap fired somewhere in this child's walk (see the module header): what
   *  is here is real, but it is not everything. Staff-visible on purpose. */
  truncated: boolean;
  /**
   * A save row EXISTS but its doc could not be read — not an object, or a
   * docVersion this build does not understand. Distinguishes "doc not loadable"
   * (the kid also sees an empty game) from "never started" (no save row at
   * all), which would otherwise be indistinguishable empty rows.
   */
  docUnreadable: boolean;
  ideas: ProgressIdea[];
  businesses: ProgressBusiness[];
};

/* -------------------------------------------------------------- row inputs */

export type ProgressChildRowLike = {
  id: string;
  fp_username?: unknown;
  /** text column; '' is the unset sentinel (see grade-rules). */
  birth_year?: unknown;
  grade?: unknown;
};

export type ProgressProfileRowLike = { id: string; child_id: string };

/** fp_player_saves: `doc` is jsonb — `unknown` until the walk narrows it. */
export type ProgressSaveRowLike = { profile_id: string; doc?: unknown };

/* ------------------------------------------------------------- doc walking */

/** JSON-object check matching jsonb_typeof(x) = 'object' (arrays excluded) —
 *  the same narrowing primitive fp-save-doc-guard-rules.ts uses at every step. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mutable truncation flag threaded through one child's walk. */
type WalkBudget = { truncated: boolean };

/**
 * Keys that would SHADOW something on `Object.prototype` if written into a
 * plain object literal.
 *
 * This is not paranoia about a hypothetical: a doc carrying
 * `doneByTask: {"hasOwnProperty": true}` survives every value-type filter, and
 * the first consumer that calls `map.hasOwnProperty(taskId)` gets a TypeError —
 * which in React blanks the entire cohort table, not just that child's row.
 * `__proto__` is worse still: assigning it into an object literal mutates the
 * prototype instead of adding a key.
 *
 * `Object.create(null)` is NOT the fix — it makes those methods missing for
 * EVERY key, breaking the same consumer unconditionally. Skipping the dangerous
 * keys is. This is JS object hygiene, not task-id domain knowledge, so it does
 * not breach the server's stay-out-of-the-content-domain rule: no real task id
 * or legacy `${stepId}#${index}` key can collide with it.
 */
function isUnsafeMapKey(key: string): boolean {
  return key === "__proto__" || key in Object.prototype;
}

/**
 * A boolean completion map, filtered to ACTUAL booleans. A string "true", a 1,
 * or a null is a writer we do not recognise — dropped rather than coerced, so
 * the client never counts a completion the kid's own client would not. Keys are
 * otherwise passed through untouched (no remapping, no normalisation) apart
 * from the isUnsafeMapKey exclusion.
 */
function narrowBooleanMap(value: unknown, budget: WalkBudget): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isJsonObject(value)) return out;
  let kept = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "boolean") continue;
    if (isUnsafeMapKey(key)) continue;
    if (kept >= PROGRESS_MAP_ENTRIES_CAP) {
      budget.truncated = true;
      break;
    }
    out[key] = entry;
    kept++;
  }
  return out;
}

/**
 * A timestamp map (epoch ms), filtered to FINITE numbers in
 * [0, PROGRESS_MAX_TIMESTAMP_MS]. String stamps, NaN, Infinity, negatives, and
 * out-of-Date-range values are dropped: every one of them would poison the
 * client's recency math, and a dropped stamp degrades to "completion with
 * unknown time" — a state the client already models — where a poisoned one
 * would silently mis-sort or crash the whole cohort view.
 */
function narrowTimestampMap(value: unknown, budget: WalkBudget): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isJsonObject(value)) return out;
  let kept = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    if (entry < 0 || entry > PROGRESS_MAX_TIMESTAMP_MS) continue;
    if (isUnsafeMapKey(key)) continue;
    if (kept >= PROGRESS_MAP_ENTRIES_CAP) {
      budget.truncated = true;
      break;
    }
    out[key] = entry;
    kept++;
  }
  return out;
}

/** A non-empty trimmed string, or null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Idea label: `fields.productName` → `fields.oneLiner` → null, trimmed
 * (whitespace-only reads as absent), then truncated to
 * PROGRESS_LABEL_MAX_CHARS. Mirrors the label precedence in the first-profit
 * repo's src/state/floorSelectors.ts. Child data — never logged.
 */
function deriveIdeaLabel(idea: Record<string, unknown>, budget: WalkBudget): string | null {
  const fields = idea.fields;
  if (!isJsonObject(fields)) return null;
  const label = trimmedOrNull(fields.productName) ?? trimmedOrNull(fields.oneLiner);
  if (label === null) return null;
  if (label.length <= PROGRESS_LABEL_MAX_CHARS) return label;
  budget.truncated = true;
  return label.slice(0, PROGRESS_LABEL_MAX_CHARS);
}

/** The wire entry for an idea slot the walk could not read as an object. */
function placeholderIdea(index: number): ProgressIdea {
  return {
    index,
    id: null,
    label: null,
    done: {},
    doneAt: {},
    doneByTask: {},
    doneAtByTask: {},
  };
}

/**
 * The ideas walk.
 *
 * A malformed entry becomes a PLACEHOLDER rather than a hole: the FP client's
 * `fromSaveDoc` runs `.map(coerceIdea)`, which COERCES a non-object into a real
 * empty idea and mints `legacy-idea-{index}` for it. Dropping it here would
 * leave the server and the kid's own client disagreeing about which indices
 * exist, and a business linking to that minted id would dangle for staff while
 * resolving fine for the child. Array HOLES (only reachable from a sparse JS
 * array — jsonb has none) are skipped, matching `.map`'s own hole semantics.
 *
 * Every surviving entry carries its ORIGINAL array index. The ideas cap takes
 * the first N entries the walk emits and stops; it never renumbers what it
 * keeps.
 */
function walkIdeas(rawIdeas: unknown, budget: WalkBudget): ProgressIdea[] {
  if (!Array.isArray(rawIdeas)) return [];
  const out: ProgressIdea[] = [];
  for (let index = 0; index < rawIdeas.length; index++) {
    if (out.length >= PROGRESS_IDEAS_CAP) {
      budget.truncated = true;
      break;
    }
    if (!Object.hasOwn(rawIdeas, index)) continue; // sparse hole
    const raw = rawIdeas[index];
    if (!isJsonObject(raw)) {
      out.push(placeholderIdea(index));
      continue;
    }
    out.push({
      index,
      id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null,
      label: deriveIdeaLabel(raw, budget),
      done: narrowBooleanMap(raw.done, budget),
      doneAt: narrowTimestampMap(raw.doneAt, budget),
      doneByTask: narrowBooleanMap(raw.doneByTask, budget),
      doneAtByTask: narrowTimestampMap(raw.doneAtByTask, budget),
    });
  }
  return out;
}

/**
 * The businesses walk. A business is IDENTIFIED by its id — there is no second
 * key (ideas have `index`; businesses do not) — so an entry without a usable
 * string id is dropped, and a DUPLICATE id keeps the FIRST occurrence only.
 * First-wins matters: a client keying rows by id would otherwise keep the LAST
 * entry, so a doc carrying `[{id:"b1", <full maps>}, {id:"b1"}]` would zero out
 * the child's own Phase 4/5 progress in the staff view. Everything else about
 * an entry degrades rather than disqualifies.
 */
function walkBusinesses(rawBusinesses: unknown, budget: WalkBudget): ProgressBusiness[] {
  if (!Array.isArray(rawBusinesses)) return [];
  const out: ProgressBusiness[] = [];
  const seen = new Set<string>();
  for (const raw of rawBusinesses) {
    if (out.length >= PROGRESS_BUSINESSES_CAP) {
      budget.truncated = true;
      break;
    }
    if (!isJsonObject(raw)) continue;
    const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null;
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      ideaId: typeof raw.ideaId === "string" && raw.ideaId.length > 0 ? raw.ideaId : null,
      archived: raw.archived === true,
      doneByTask: narrowBooleanMap(raw.doneByTask, budget),
      doneAtByTask: narrowTimestampMap(raw.doneAtByTask, budget),
    });
  }
  return out;
}

export type WalkedSaveDoc = {
  ideas: ProgressIdea[];
  businesses: ProgressBusiness[];
  truncated: boolean;
  docUnreadable: boolean;
};

/**
 * One save doc → the per-child progress payload. Total and fail-closed: a doc
 * that is not an object, or whose `docVersion` this build does not understand,
 * yields empty structures with `docUnreadable: true`; a doc whose `ideas` is
 * not an array simply yields no ideas. Never throws.
 *
 * `deletedIdeaIds` (the tombstone set) is deliberately IGNORED, and that
 * matches the client: the FP client's `fromSaveDoc` does not filter tombstoned
 * ideas out of the doc either, so honoring them here would show staff FEWER
 * ideas than the child sees. Do not "fix" this without changing both.
 *
 * @internal Exported as a test seam, not part of the route contract.
 */
export function walkSaveDoc(doc: unknown): WalkedSaveDoc {
  if (!isJsonObject(doc) || doc.docVersion !== PROGRESS_DOC_VERSION) {
    return { ideas: [], businesses: [], truncated: false, docUnreadable: true };
  }
  const budget: WalkBudget = { truncated: false };
  const ideas = walkIdeas(doc.ideas, budget);
  const businesses = walkBusinesses(doc.businesses, budget);
  return { ideas, businesses, truncated: budget.truncated, docUnreadable: false };
}

/* --------------------------------------------------------- band derivation */

/**
 * Band from the roster row via the authority the login/grade routes already
 * use: `resolveChildGrade` (a set birth_year WINS over the stored grade, so the
 * value never goes stale across school years) → `bandForGrade`. Null when
 * neither source resolves, or when the grade falls outside the three bands —
 * the client renders "—" and groups nulls last.
 *
 * @internal Exported as a test seam, not part of the route contract.
 */
export function bandForChildRow(child: ProgressChildRowLike, now: Date): Band | null {
  const birthYear = typeof child.birth_year === "string" ? child.birth_year : "";
  const storedGrade = typeof child.grade === "number" ? child.grade : null;
  return bandForGrade(resolveChildGrade({ birthYear, storedGrade }, now));
}

/* ------------------------------------------------------------ row shaping */

/**
 * Pure Map-join + projection (the suggestions id-set style): roster rows →
 * profiles by child_id → saves by profile_id → the wire contract. `now` is a
 * parameter rather than a `new Date()` inside so the module stays pure and the
 * band derivation is testable at a pinned instant.
 *
 * A child with no fp_username is skipped (the route's query already excludes
 * them; this is the fail-closed second half). A child with no profile row or no
 * save row is PRESENT in the output with empty ideas/businesses and
 * `docUnreadable: false` — that is the "never started" signal the stuck list is
 * built from, and dropping the row would make a stalled kid invisible, which is
 * the exact failure this dashboard exists to prevent.
 */
export function shapeProgress(
  children: readonly ProgressChildRowLike[],
  profiles: readonly ProgressProfileRowLike[],
  saves: readonly ProgressSaveRowLike[],
  now: Date
): ProgressChild[] {
  // First row wins on duplicates: the schema is one profile per child
  // (child_id unique) and one save per profile (profile_id PK), so this is
  // unreachable — and inventing a merge rule here would hide a data bug behind
  // a plausible-looking number.
  const profileByChildId = new Map<string, ProgressProfileRowLike>();
  for (const p of profiles) if (!profileByChildId.has(p.child_id)) profileByChildId.set(p.child_id, p);

  const saveByProfileId = new Map<string, ProgressSaveRowLike>();
  for (const s of saves) if (!saveByProfileId.has(s.profile_id)) saveByProfileId.set(s.profile_id, s);

  const out: ProgressChild[] = [];
  for (const child of children) {
    // Not trimmed: the username is an IDENTITY value the client matches
    // against, so it passes through exactly as stored — only absent/empty
    // disqualifies.
    if (typeof child.fp_username !== "string" || child.fp_username.length === 0) continue;
    const profile = profileByChildId.get(child.id);
    const save = profile ? saveByProfileId.get(profile.id) : undefined;
    const walked: WalkedSaveDoc = save
      ? walkSaveDoc(save.doc)
      : { ideas: [], businesses: [], truncated: false, docUnreadable: false };
    out.push({
      username: child.fp_username,
      band: bandForChildRow(child, now),
      truncated: walked.truncated,
      docUnreadable: walked.docUnreadable,
      ideas: walked.ideas,
      businesses: walked.businesses,
    });
  }
  return out;
}
