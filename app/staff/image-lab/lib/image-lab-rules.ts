/**
 * Image Lab — shared schema/storage vocabulary and the pure rules over it
 * (Unit 1).
 *
 * Pure module: no next/supabase/react imports, so the node test suite can pin
 * every closed set and bound here, and the migration-parity test can prove the
 * SQL agrees (docs/solutions/test-failures/security-definer-sql-case-third-
 * untested-copy-parse-migration-file — there is no test DB in this suite, so a
 * value living in BOTH a TS artifact and a .sql file needs a parse-the-file
 * parity test or the two drift silently).
 *
 * Everything below is consumed by later units: the registry (Unit 2) maps model
 * ids, the reference library (Unit 4) validates uploads, and the run flow
 * (Unit 5) writes the states and failure reasons.
 *
 * DESIGN RULE, learned the hard way in review: this module exports BEHAVIOUR,
 * not primitives that each caller must remember to use correctly. A shared
 * mutable regex and a documented-but-unimplemented staleness rule were both
 * caught here as latent bugs — the fix in each case was to export the function
 * instead of the ingredient (the app/fp/lib/upload-rules.ts precedent, which
 * exports `isTusUrlExpired` rather than making callers subtract against a TTL).
 */

// ── The go-live flag ──────────────────────────────────────────────────────────

/**
 * Generation is off unless `IMAGE_LAB_LIVE` is explicitly on.
 *
 * A FLAG, NOT A KEY SNIFF: gateway auth is implicit, so a key may well be
 * present in every environment the moment the funnel works — making key-presence
 * a gate that is already open everywhere and gates nothing. This flag is the
 * deliberate act of switching a priced bench on.
 *
 * Read at CALL TIME, never captured at module load: a module-level constant
 * would freeze the value into a warm serverless instance, so flipping the flag
 * would take effect only for containers that happened to cold-start after it.
 *
 * Allowlisted values only. `IMAGE_LAB_LIVE=false` and `=0` are the two ways an
 * operator says "off" in a dashboard, and a plain truthiness check reads BOTH
 * as on — the single most expensive way to misread an env var here.
 *
 * LIVES IN THIS PLAIN MODULE, not in the `server-only` `./image-model` that
 * consumes it, because its other readers are SHELL surfaces — the `/staff` hub
 * card and the bench notice — that want one boolean and nothing else. Reading
 * it from the adapter dragged `server-only`, the `ai` SDK and the 454-line
 * registry into the staff front door. `./image-model` re-exports it, so its
 * existing importers are unchanged. (docs/solutions/best-practices/
 * server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md)
 */
export function isImageLabLive(): boolean {
  const raw = process.env.IMAGE_LAB_LIVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * ⚠ THERE IS NO SECOND FLAG ANY MORE (2026-08-06, owner decision).
 *
 * `IMAGE_LAB_REAL_CONTENT_LIVE` used to gate the content picker as "the
 * technical enforcement of the consent check". Consent was removed from the Lab
 * entirely on two verified facts: reference images will only ever be
 * AI-GENERATED, so no child photo, drawing or likeness can reach a vendor; and
 * the owner's legal advice cleared SCRUBBED child-authored business text as not
 * personal data of a child. With no consent question left, a flag that gated it
 * gated nothing, so the picker is always available and `IMAGE_LAB_LIVE` above is
 * the Lab's only switch.
 *
 * The consequences of that removal are documented where they land — see
 * `content-picker-core.scrubNames` (the scrub is no longer server-enforceable)
 * and the runbook's purge section (deletion requests cannot be serviced by
 * child). They are accepted, not overlooked.
 */

// ── Storage ───────────────────────────────────────────────────────────────────

/** The private bucket the migration creates. Never public; reads are signed. */
export const IMAGE_LAB_BUCKET = "fp-image-lab";

/**
 * Per-object ceiling, kept byte-identical to the bucket's file_size_limit in
 * the migration (parity test). 25 MB: generous for a 4K generated PNG (the
 * largest thing this bucket stores) while staying under the project's 50 MB
 * Free-tier hard ceiling documented in
 * supabase/migrations/20260722140000_path_storage.sql. Raise BOTH together —
 * and a test pins that this stays under the tier ceiling, because raising the
 * pair past it would otherwise surface only as an opaque storage error.
 */
export const IMAGE_LAB_MAX_OBJECT_BYTES = 26214400; // 25 * 1024 * 1024

/** The project's Free-tier per-object hard ceiling (path_storage.sql). */
export const SUPABASE_TIER_MAX_OBJECT_BYTES = 52428800; // 50 * 1024 * 1024

/**
 * Accepted image types. Deliberately a short allowlist rather than `image/*`:
 * references are character sheets and style samples, and every launch model
 * accepts these three.
 *
 * ⚠ ENFORCEMENT LIVES IN THE BUCKET, NOT ONLY HERE. On the reference leg the
 * BROWSER sets the object's content-type at PUT time (the server mints the slot
 * but cannot bind the type — see app/fp/lib/actions/upload-slot.ts), so this
 * predicate governs the DB row while `allowed_mime_types` on the bucket governs
 * the OBJECT. Both exist on purpose: without the bucket rule an `image/svg+xml`
 * upload would be served by signed URL to a staff browser, and an SVG is an
 * executable document on the storage origin.
 */
export const IMAGE_LAB_ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type ImageLabMimeType = (typeof IMAGE_LAB_ACCEPTED_MIME_TYPES)[number];

/**
 * Canonicalize a declared content type, or null if it is not an accepted image.
 *
 * Takes `string | null | undefined` because its documented inputs are a
 * `Content-Type` header and a `File.type`, both routinely absent — typing it
 * `string` only pushes `?? ""` (and eventually `!`) out to every call site.
 *
 * Per RFC 2045 the type/subtype is case-INSENSITIVE and parameters are legal,
 * so `image/PNG` and `image/png; charset=utf-8` are valid declarations of an
 * accepted image and normalize rather than refuse. Refusing them would burn a
 * paid generation whose bytes were fine, or refuse an upload with a message
 * naming three types the user believes they sent.
 *
 * Returns the canonical form so callers STORE that, never the raw header.
 */
export function normalizeMimeType(
  value: string | null | undefined
): ImageLabMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]!.trim().toLowerCase();
  return (IMAGE_LAB_ACCEPTED_MIME_TYPES as readonly string[]).includes(base)
    ? (base as ImageLabMimeType)
    : null;
}

/**
 * Convenience predicate over {@link normalizeMimeType}.
 *
 * ⚠ TEST-ONLY BY DESIGN, and noted rather than folded away. Production code
 * always wants the NORMALIZED VALUE (it goes on the row), never just a yes/no —
 * so every real caller uses `normalizeMimeType` and a `!== null` check, and a
 * production caller of this predicate would be one that threw the answer away and
 * then had to re-derive it. What it earns its keep for is the migration parity
 * test, which asserts the bucket's `allowed_mime_types` against this module as a
 * SET-MEMBERSHIP question and has no use for the normalized form.
 *
 * Same honesty as {@link pricedQualityTiers} in the registry, which says so too.
 */
export function isAcceptedMimeType(value: string | null | undefined): boolean {
  return normalizeMimeType(value) !== null;
}

// ── Membership guards ─────────────────────────────────────────────────────────

/**
 * Every closed set below is stored in Postgres as `text` with a CHECK, and the
 * Supabase client hands a `text` column back as `string`. Without a guard, the
 * path of least resistance at every read boundary in Units 5–6 is
 * `row.state as ImageLabImageState` — an unchecked assertion that switches the
 * checker off exactly where the DB and the TS model could have drifted (a
 * hand-run SQL fix, a partially applied migration, a row predating a CHECK).
 * The parity test proves the LISTS agree; only these guards check a ROW.
 */
const memberOf =
  <T extends string>(set: readonly T[]) =>
  (value: string | null | undefined): value is T =>
    typeof value === "string" && (set as readonly string[]).includes(value);

// ── Image row lifecycle ───────────────────────────────────────────────────────

/**
 * The three PERSISTED states. Deliberately three, not four: "attempted" is not
 * a state but the `attempted_at` stamp, and "stale" is a DERIVED render label
 * (see {@link isImageStale}) — never written.
 *
 * The reason that matters: the mark-attempt transition is an atomic CAS on
 * `attempted_at is null`, so a row that is `requested` with a non-null
 * attempted_at is in flight and refuses a second vendor call. A fourth
 * persisted state would give two writers two ways to disagree.
 */
export const IMAGE_LAB_IMAGE_STATES = ["requested", "done", "failed"] as const;
export type ImageLabImageState = (typeof IMAGE_LAB_IMAGE_STATES)[number];
export const isImageLabImageState = memberOf(IMAGE_LAB_IMAGE_STATES);

/**
 * Structured failure reasons — the closed set the adapter normalizes into and
 * the history view filters on (Unit 6 breaks `timeout` and `safety_blocked` out
 * of the keep-rate denominator, because both are infra/ops artifacts asymmetric
 * across models and folding them in would bias the model decision the Lab
 * exists to make).
 *
 * `unconfigured` means nothing was dialled at all (bench off / no key) — it
 * still takes the CAS, so `attempted_at` is set, but `billed` stays false. That
 * split is why the images table carries a `billed` column: `attempted_at` means
 * "latched", `billed` means "this will appear on the invoice".
 */
export const IMAGE_LAB_FAILURE_REASONS = [
  "safety_blocked",
  "timeout",
  "rate_limited",
  "provider_error",
  "unconfigured",
] as const;
export type ImageLabFailureReason = (typeof IMAGE_LAB_FAILURE_REASONS)[number];
export const isImageLabFailureReason = memberOf(IMAGE_LAB_FAILURE_REASONS);

/**
 * Failure reasons that are OUR artifact rather than the model's answer, and so
 * must be excluded from the keep-rate denominator (Unit 6). A timeout reflects
 * our own adapter budget; a safety block on the Google models reflects a
 * pending `personGeneration` allowlist. Counting either as a model's failure
 * biases the comparison toward the vendor we happen to be worst at calling.
 */
export const KEEP_RATE_EXCLUDED_FAILURES = ["timeout", "safety_blocked"] as const;

/** Verdicts. Absent (null) means "not yet judged" — a third state, not a value. */
export const IMAGE_LAB_VERDICTS = ["keep", "reject"] as const;
export type ImageLabVerdict = (typeof IMAGE_LAB_VERDICTS)[number];
export const isImageLabVerdict = memberOf(IMAGE_LAB_VERDICTS);

/**
 * How long a non-finalized cell may sit before the UI calls it stale and
 * re-enables retry. 10 minutes is comfortably past the slowest single
 * generation (gpt-image-2 at high quality tops out around two minutes) —
 * retrying earlier risks paying twice for a call still running server-side.
 *
 * Prefixed to match the repo's other staleness constant
 * (app/fp/lib/fw-board-rules.ts FW_BOARD_STALE_AFTER_MS): two same-shaped
 * "stale after" values with different magnitudes live in this codebase, and an
 * unprefixed import is a wrong-import no test would catch.
 */
export const IMAGE_LAB_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Is a non-finalized cell old enough that offering Retry is safe?
 *
 * DERIVED at read time, never persisted. Two age bases, which is the whole
 * reason this is a function and not a subtraction each caller writes: a row
 * picked up by a route ages from `attempted_at`, and a row whose tab closed
 * before it ever fired ages from `created_at`. The naive
 * `now - attemptedAt` yields NaN for the second case, which reads as
 * "not stale" and leaves the cell un-retryable forever.
 *
 * ⚠ `serverNowMs` MUST come from the server (the same clock that stamped
 * `attempted_at`), never `Date.now()` in the browser. A laptop whose clock runs
 * fifteen minutes fast — routine after a suspend — would otherwise mark every
 * cell stale the instant it is minted and offer Retry on a call that is still
 * running, paying twice; a slow clock never offers Retry at all. The parameter
 * is named for the requirement so a browser-sourced value looks wrong at the
 * call site.
 *
 * `>=` at the boundary errs toward offering a retry a millisecond early rather
 * than wedging a genuinely dead cell.
 */
export function isImageStale(
  row: { attemptedAtMs: number | null; createdAtMs: number },
  serverNowMs: number,
  staleAfterMs: number = IMAGE_LAB_STALE_AFTER_MS
): boolean {
  const since = row.attemptedAtMs ?? row.createdAtMs;
  if (!Number.isFinite(since) || !Number.isFinite(serverNowMs)) return false;
  return serverNowMs - since >= staleAfterMs;
}

// ── Drill tags ────────────────────────────────────────────────────────────────

/**
 * The roadmap's three drills, as run tags. v1 deliberately tags a run rather
 * than imposing a structured drill workflow (origin: "drills are tags, not
 * workflows in v1") — a consistency drill is reconstructed by filtering history
 * on its reference image, which is why the runs table stores reference_ids.
 *
 * Closed in SQL too (`drill_tags <@ array[...]`), because an unconstrained
 * text[] would let a client write `kid_appeal` for `kid-appeal` and silently
 * drop that run out of every drill filter with no error anywhere.
 */
export const IMAGE_LAB_DRILL_TAGS = ["consistency", "style", "kid-appeal"] as const;
export type ImageLabDrillTag = (typeof IMAGE_LAB_DRILL_TAGS)[number];
export const isImageLabDrillTag = memberOf(IMAGE_LAB_DRILL_TAGS);

// ── Prompt slots ──────────────────────────────────────────────────────────────

/**
 * The v1 slot vocabulary — the contract a kept prompt carries into the panel
 * engine. The engine will fill these same four from a child's record, which is
 * the whole reason the Lab keeps templates rather than resolved text.
 *
 * `sale` deliberately excludes the buyer's name (origin R12a): sale details
 * routinely name a neighbour or relative, and no third-party model call needs
 * that to draw a panel.
 */
export const IMAGE_LAB_SLOTS = ["product", "oneLiner", "pitch", "sale"] as const;
export type ImageLabSlot = (typeof IMAGE_LAB_SLOTS)[number];
export const isImageLabSlot = memberOf(IMAGE_LAB_SLOTS);

/**
 * A FRESH `{{slot}}` matcher per call.
 *
 * ⚠ Deliberately a factory, never a shared exported constant. A module-level
 * `/g` regex carries `lastIndex` across every use, so `test()` on the same
 * string alternates true/false and an `exec` loop that breaks early poisons the
 * next caller — and in a Next.js server module that object outlives the
 * request, so one staff member's aborted scan changes another's result. The
 * repo has already paid for this once (app/lib/funnel/moderation.ts resets
 * `lastIndex` defensively in two places); every other exported pattern here is
 * non-global for the same reason (app/api/fp/login/profile-rules.ts).
 *
 * Case-sensitive: slot names are camelCase, so `{{OneLiner}}` is a typo. It
 * still MATCHES as a well-formed token and is reported as an unknown slot,
 * which is what lets the composer warn about it — a non-match would let it slip
 * through to a vendor silently.
 */
const slotMatcher = () => /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Every `{{slot}}` token in a template, in first-appearance order, de-duplicated.
 * Returns raw token names (NOT narrowed to {@link ImageLabSlot}) so the caller
 * can tell a known slot from a typo and warn about the difference.
 */
export function extractSlotNames(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(slotMatcher())) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

/**
 * Split a template's slots into the ones we know how to fill and the ones we do
 * not. `unknown` drives the composer's warn-not-block notice; a deliberate
 * template test with a literal `{{whatever}}` is legitimate and must still be
 * allowed to generate.
 */
export function classifySlots(template: string): {
  known: ImageLabSlot[];
  unknown: string[];
} {
  const known: ImageLabSlot[] = [];
  const unknown: string[] = [];
  for (const name of extractSlotNames(template)) {
    if (isImageLabSlot(name)) known.push(name);
    else unknown.push(name);
  }
  return { known, unknown };
}
